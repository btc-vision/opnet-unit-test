import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, Transaction } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import {
    IActivateProviderEvent,
    IProviderFulfilledEvent,
    IReservationPurgedEvent,
    ITransferEvent,
} from '../../../contracts/NativeSwapTypes.js';
import {
    helper_cancelLiquidityNew,
    helper_createPoolNew,
    helper_createTokenNew,
    helper_listLiquidityNew,
    helper_reserveNew,
    helper_swapNew,
} from '../../utils/OperationHelperNew.js';
import {
    assertCancelListLiquidityEventsHelper,
    decodeCancelListLiquidityEventsHelper,
} from './CancelListLiquidityEventsHelper.js';
import {
    assertCreatePoolEventsHelper,
    decodeCreatePoolEventsHelper,
} from './CreatePoolEventsHelper.js';
import {
    assertCurrentLiquidityReserveHelper,
    LiquidityReserveHelper,
} from './LiquidityReserveHelper.js';
import {
    assertListLiquidityEventsHelper,
    decodeListLiquidityEventsHelper,
} from './ListLiquidityEventsHelper.js';
import { ProviderHelper, ProviderSnapshotHelper } from './ProviderHelper.js';
import { decodeReserveLiquidityEventsHelper } from './ReserveLiquidityEventsHelper.js';
import { ReserveLiquidityHelper } from './ReserveLiquidityHelper.js';
import { assertReservedSwapperProviders, decodeSwapEventsHelper } from './SwapEventsHelper.js';
import {
    assertNativeSwapBalanceHelper,
    assertProviderBalanceHelper,
    assertStakingBalanceHelper,
    TokenHelper,
} from './TokenHelper.js';
import { calculatePenaltyLeft, computeSlashing, expandNumberTo18Decimals } from './UtilsHelper.js';

export const TOKEN_NUMBER: number = 10;
const ENABLE_LOG: boolean = true;
const nativeSwapOwnerAddress: Address = Blockchain.generateRandomAddress();
const nativeSwapContractAddress: Address = Blockchain.generateRandomAddress();
const stakingContractAddress: Address = Blockchain.generateRandomAddress();
let nativeSwap: NativeSwap;
let tokenArray: TokenHelper[] = [];
let providerArray: ProviderHelper[] = [];
let reservationArray: ReserveLiquidityHelper[] = [];
let origin: Address;
let sender: Address;

export async function initBlockchain(): Promise<void> {
    tokenArray = [];
    providerArray = [];
    reservationArray = [];
    Blockchain.dispose();
    Blockchain.clearContracts();
    await Blockchain.init();
}

export function disposeBlockchain(): void {
    nativeSwap.dispose();
    disposeTokens();
    Blockchain.dispose();
}

export async function initNativeSwap(): Promise<void> {
    nativeSwap = new NativeSwap(nativeSwapOwnerAddress, nativeSwapContractAddress);
    Blockchain.register(nativeSwap);
    await nativeSwap.init();

    pushOriginSender();
    Blockchain.txOrigin = nativeSwapOwnerAddress;
    Blockchain.msgSender = nativeSwapOwnerAddress;
    await nativeSwap.setStakingContractAddress({ stakingContractAddress });
    popOriginSender();
}

export async function createTokens(): Promise<void> {
    for (let i = 0; i < TOKEN_NUMBER; i++) {
        const ownerAddress: Address = Blockchain.generateRandomAddress();
        const token = await helper_createTokenNew(
            ownerAddress,
            18,
            expandNumberTo18Decimals(10000000),
        );

        tokenArray.push(
            new TokenHelper(
                token,
                ownerAddress,
                stakingContractAddress,
                nativeSwapContractAddress,
                `TOKEN_${i}`,
            ),
        );
    }
}

export function getToken(index: number): TokenHelper {
    return tokenArray[index];
}

export function disposeTokens(): void {
    for (let i = 0; i < TOKEN_NUMBER; i++) {
        tokenArray[i].token.dispose();
    }

    tokenArray = [];
}

export function pushOriginSender(): void {
    origin = Blockchain.txOrigin;
    sender = Blockchain.msgSender;
}

export function popOriginSender(): void {
    Blockchain.txOrigin = origin;
    Blockchain.msgSender = sender;
}

export function getProvider(providerId: bigint): ProviderHelper | null {
    const result = providerArray.find((p) => p.id === providerId);

    return result === undefined ? null : result;
}

export function getProviderByAddress(providerAddress: Address): ProviderHelper | null {
    const result = providerArray.find((p) => p.address.toString() === providerAddress.toString());

    return result === undefined ? null : result;
}

export function removeProvider(provider: ProviderHelper): void {
    Blockchain.log(`Removing provider: ${provider.id}`);
    const index = providerArray.indexOf(provider);

    if (index === -1) {
        throw new Error('Provider not found');
    }

    providerArray.splice(index, 1);
}

export function getReservation(reservationId: bigint): ReserveLiquidityHelper | null {
    const result = reservationArray.find((r) => r.reservationId === reservationId);

    return result === undefined ? null : result;
}

export function getTransactionTotalAmount(transaction: Transaction): bigint {
    let total: bigint = 0n;

    for (let i = 0; i < transaction.outputs.length; i++) {
        total += transaction.outputs[i].value;
    }

    return total;
}

export async function getReservedProvidersSnapshot(
    reservation: ReserveLiquidityHelper,
): Promise<Map<bigint, ProviderSnapshotHelper>> {
    const result = new Map<bigint, ProviderSnapshotHelper>();

    for (let i = 0; i < reservation.recipients.length; i++) {
        const provider = getProvider(reservation.recipients[i].providerId);
        if (provider === null) {
            throw new Error(`Provider not found: ${reservation.recipients[i].providerId}`);
        }

        await provider.update(nativeSwap);

        result.set(provider.id, ProviderSnapshotHelper.create(provider));
    }

    return result;
}

export function getTransferAmount(
    transferEvents: ITransferEvent[],
    from: Address,
    to: Address,
): bigint {
    const transfer = transferEvents.find(
        (t) => t.from.toString() === from.toString() && t.to.toString() == to.toString(),
    );

    return transfer === undefined ? 0n : transfer.amount;
}

export async function processProviderActivated(
    providerActivatedEvents: IActivateProviderEvent[],
): Promise<void> {
    for (let i = 0; i < providerActivatedEvents.length; i++) {
        const provider = getProvider(providerActivatedEvents[i].providerId);
        Assert.expect(provider).toNotEqual(null);

        if (provider === null) {
            throw new Error(`Provider not found`);
        }

        await provider.update(nativeSwap);
    }
}

export function processPurgedReservation(
    purgedReservationEvents: IReservationPurgedEvent[],
): bigint {
    let totalPurged: bigint = 0n;

    for (let i = 0; i < purgedReservationEvents.length; i++) {
        const purgedReservation = getReservation(purgedReservationEvents[i].reservationId);

        Assert.expect(purgedReservation).toNotEqual(null);

        if (purgedReservation !== null) {
            purgedReservation.purged = true;
            purgedReservation.purgeIndex = purgedReservationEvents[i].purgeIndex;
            purgedReservation.purgedAmount = purgedReservationEvents[i].purgedAmount;
            totalPurged += purgedReservation.purgedAmount;
        }

        Blockchain.log(
            `purge: ${purgedReservationEvents[i].reservationId}, amount: ${purgedReservationEvents[i].purgedAmount} `,
        );
    }

    return totalPurged;
}

export async function processProviderFulfilled(
    providerFulfilledEvents: IProviderFulfilledEvent[],
): Promise<bigint> {
    let transferToStakingAmount: bigint = 0n;

    for (let i = 0; i < providerFulfilledEvents.length; i++) {
        const provider = getProvider(providerFulfilledEvents[i].providerId);

        Assert.expect(provider).toNotEqual(null);

        if (provider === null) {
            throw new Error(`Provider not found`);
        }

        provider.setFulfilled(true);
        transferToStakingAmount += providerFulfilledEvents[i].stakedAmount;
        await provider.update(nativeSwap);
        Assert.expect(provider.liquidity).toEqual(0n);
        Assert.expect(provider.isActive).toEqual(false);

        //!!!! removeProvider(provider);
    }

    return transferToStakingAmount;
}

export async function createPool(
    tokenHelper: TokenHelper,
    initialLiquidityAmount: bigint,
    floorPrice: bigint,
): Promise<ProviderHelper> {
    pushOriginSender();

    const provider: ProviderHelper = new ProviderHelper(
        tokenHelper.ownerAddress,
        tokenHelper,
        false,
        true,
    );

    const providerInitialTokenAmount: bigint = await provider.getBalance();

    const result = await helper_createPoolNew(
        nativeSwap,
        tokenHelper.token,
        provider.address,
        provider.address,
        floorPrice,
        initialLiquidityAmount,
        100,
        ENABLE_LOG,
        true,
    );

    const decodedEvents = decodeCreatePoolEventsHelper(result.response.events);

    assertCreatePoolEventsHelper(
        nativeSwapContractAddress,
        provider,
        initialLiquidityAmount,
        decodedEvents,
    );

    await provider.update(nativeSwap);

    tokenHelper.isPoolCreated = true;
    tokenHelper.setInitialLiquidityProviderAddress(provider.address);

    Assert.expect(provider.liquidity).toEqual(initialLiquidityAmount);
    Assert.expect(provider.reserved).toEqual(0n);

    await assertProviderBalanceHelper(provider, providerInitialTokenAmount);
    await assertNativeSwapBalanceHelper(tokenHelper, initialLiquidityAmount);
    await assertStakingBalanceHelper(tokenHelper, 0n);
    await assertCurrentLiquidityReserveHelper(
        nativeSwap,
        tokenHelper,
        initialLiquidityAmount,
        0n,
        initialLiquidityAmount / floorPrice,
        initialLiquidityAmount,
    );

    popOriginSender();

    providerArray.push(provider);
    return provider;
}

export async function listLiquidity(
    tokenHelper: TokenHelper,
    providerAddress: Address,
    amountIn: bigint,
    priority: boolean = false,
): Promise<ProviderHelper> {
    // Create the provider
    const provider: ProviderHelper = new ProviderHelper(providerAddress, tokenHelper, priority);

    // List provider liquidity
    await relistLiquidity(provider, amountIn, priority);

    // Add provider to providers array
    providerArray.push(provider);

    return provider;
}

export async function relistLiquidity(
    provider: ProviderHelper,
    amountIn: bigint,
    priority: boolean,
): Promise<void> {
    pushOriginSender();

    // Get initial balances and reserve
    const initialReserve = await LiquidityReserveHelper.create(nativeSwap, provider.tokenHelper);
    const initialProviderLiquidity = provider.liquidity;
    const initialProviderBalance = await provider.getBalance();
    const initialStakingBalance = await provider.tokenHelper.getStakingContractBalance();
    const initialNativeSwapBalance = await provider.tokenHelper.getNativeSwapContractBalance();

    // List provider liquidity
    const result = await helper_listLiquidityNew(
        nativeSwap,
        provider.tokenHelper.token,
        provider.address,
        amountIn,
        priority,
        provider.address,
        false,
        true,
        ENABLE_LOG,
    );

    // Compute tax if required
    let tax = 0n;

    if (provider.isPriority) {
        tax = (amountIn * 30n) / 1000n;
    }

    // Decode the list liquidity events
    const decodedEvents = decodeListLiquidityEventsHelper(result.response.events);

    // Validate list liquidity events
    assertListLiquidityEventsHelper(
        nativeSwapContractAddress,
        stakingContractAddress,
        provider,
        amountIn,
        tax,
        decodedEvents,
    );

    provider.setFulfilled(false);

    // Update the provider
    await provider.update(nativeSwap);

    // Validate provider liquidity
    const newProviderLiquidity = initialProviderLiquidity + amountIn - tax;
    Assert.expect(provider.liquidity).toEqual(newProviderLiquidity);

    // Validate provider balance
    // Should stay the same as we mint the exact amount in helper_listLiquidityNew
    const newProviderBalance = initialProviderBalance;
    await assertProviderBalanceHelper(provider, newProviderBalance);

    // Validate nativeswap balance
    const newNativeSwapBalance = initialNativeSwapBalance + amountIn - tax;
    await assertNativeSwapBalanceHelper(provider.tokenHelper, newNativeSwapBalance);

    // Validate staking balance
    const newStakingBalance = initialStakingBalance + tax;
    await assertStakingBalanceHelper(provider.tokenHelper, newStakingBalance);

    // Validate reserve
    const slashing = computeSlashing(initialReserve.virtualTokenReserve, amountIn);
    const newReserveLiquidity = initialReserve.liquidity + amountIn - tax;

    await assertCurrentLiquidityReserveHelper(
        nativeSwap,
        provider.tokenHelper,
        newReserveLiquidity,
        initialReserve.reservedLiquidity,
        initialReserve.virtualBTCReserve,
        initialReserve.virtualTokenReserve + slashing + tax,
    );

    popOriginSender();
}

export async function cancelLiquidity(provider: ProviderHelper): Promise<void> {
    pushOriginSender();

    // Get initial balances and reserve
    const initialReserve = await LiquidityReserveHelper.create(nativeSwap, provider.tokenHelper);
    const initialProviderLiquidity = provider.liquidity;
    const initialProviderBalance = await provider.getBalance();
    const initialStakingBalance = await provider.tokenHelper.getStakingContractBalance();
    const initialNativeSwapBalance = await provider.tokenHelper.getNativeSwapContractBalance();

    // Cancel provider liquidity
    const result = await helper_cancelLiquidityNew(
        nativeSwap,
        provider.tokenHelper.token.address,
        provider.address,
        ENABLE_LOG,
    );

    // Decode the cancellation events
    const decodedEvents = decodeCancelListLiquidityEventsHelper(result.response.events);

    if (decodedEvents.listingCancelledEvent === null) {
        throw new Error('Listing was not cancelled.');
    }

    // Validate cancellation events
    assertCancelListLiquidityEventsHelper(
        nativeSwapContractAddress,
        stakingContractAddress,
        provider,
        decodedEvents,
    );

    // Update the provider
    await provider.update(nativeSwap);

    // Provider should not provide liquidity anymore
    Assert.expect(provider.liquidity).toEqual(0n);

    // Validate provider balance.
    // Provider should be fully refunded less penalty
    await assertProviderBalanceHelper(
        provider,
        initialProviderBalance +
            decodedEvents.listingCancelledEvent.amount -
            decodedEvents.listingCancelledEvent.penalty,
    );

    const totalAmountPurged = processPurgedReservation(decodedEvents.purgedReservationEvents);
    const transferToStakingAmount = await processProviderFulfilled(
        decodedEvents.providerFulfilledEvents,
    );

    // Validate the new nativeSwap balance
    const newNativeSwapBalance =
        initialNativeSwapBalance -
        decodedEvents.listingCancelledEvent.amount -
        transferToStakingAmount;
    await assertNativeSwapBalanceHelper(provider.tokenHelper, newNativeSwapBalance);

    // Validate staking balance.
    let newStakingBalance =
        initialStakingBalance +
        decodedEvents.listingCancelledEvent.penalty +
        transferToStakingAmount;
    await assertStakingBalanceHelper(provider.tokenHelper, newStakingBalance);

    // Validate the new reserve
    const newLiquidity =
        initialReserve.liquidity - transferToStakingAmount - initialProviderLiquidity;
    const newReservedLiquidity = initialReserve.reservedLiquidity - totalAmountPurged;
    const penaltyLeft = calculatePenaltyLeft(
        initialProviderLiquidity,
        decodedEvents.listingCancelledEvent.penalty,
    );

    await assertCurrentLiquidityReserveHelper(
        nativeSwap,
        provider.tokenHelper,
        newLiquidity,
        newReservedLiquidity,
        initialReserve.virtualBTCReserve,
        initialReserve.virtualTokenReserve + penaltyLeft,
    );

    popOriginSender();
}

export async function reserveLiquidity(
    tokenHelper: TokenHelper,
    reserver: Address,
    amountInSats: bigint,
    minAmountOutTokens: bigint = 0n,
    activationDelay: number = 2,
    feesAddress: string = '',
): Promise<ReserveLiquidityHelper | null> {
    pushOriginSender();

    let reservation: ReserveLiquidityHelper | null = null;

    // Get initial balances and reserve
    const initialStakingBalance: bigint = await tokenHelper.getStakingContractBalance();
    const initialNativeSwapBalance = await tokenHelper.getNativeSwapContractBalance();
    const initialReserve = await LiquidityReserveHelper.create(nativeSwap, tokenHelper);

    // Create the reservation
    const result = await helper_reserveNew(
        nativeSwap,
        tokenHelper.token.address,
        reserver,
        amountInSats,
        minAmountOutTokens,
        ENABLE_LOG,
        activationDelay,
        feesAddress,
    );

    // Decode reservations events
    const decodedEvents = decodeReserveLiquidityEventsHelper(result.response.events);

    // Must have a valid reservation created event
    Assert.expect(decodedEvents.reservationCreatedEvent).toNotEqual(null);
    if (decodedEvents.reservationCreatedEvent === null) {
        throw new Error('No reservation created');
    }

    // When reservation complete and liquidity was reserved, we
    // must have at least 1 liquidity reserved event
    if (decodedEvents.reservationCreatedEvent.expectedAmountOut > 0n) {
        Assert.expect(decodedEvents.liquidityReservedEvents.length).toBeGreaterThan(0);
    }

    // Create a reservation object with the decoded events
    // and store it in the reservations array
    reservation = await ReserveLiquidityHelper.create(
        nativeSwap,
        tokenHelper,
        reserver,
        decodedEvents.reservationCreatedEvent,
        decodedEvents.liquidityReservedEvents,
        providerArray,
    );

    reservationArray.push(reservation);

    // Process the reservation purged events and get the total purged amount
    const totalAmountPurged = processPurgedReservation(decodedEvents.purgedReservationEvents);

    // Process the provider fulfilled events and get the total transferred to the staking contract
    const transferToStakingAmount = await processProviderFulfilled(
        decodedEvents.providerFulfilledEvents,
    );

    // Validate new staking balance
    const newStakingBalance = initialStakingBalance + transferToStakingAmount;
    await assertStakingBalanceHelper(tokenHelper, newStakingBalance);

    // Validate the new nativeSwap balance
    const newNativeSwapBalance = initialNativeSwapBalance - transferToStakingAmount;
    await assertNativeSwapBalanceHelper(tokenHelper, newNativeSwapBalance);

    // Validate the new reserve
    const newLiquidity = initialReserve.liquidity - transferToStakingAmount;
    const newReservedLiquidity =
        initialReserve.reservedLiquidity +
        (reservation !== null ? reservation.expectedAmountOut : 0n) -
        totalAmountPurged;

    await assertCurrentLiquidityReserveHelper(
        nativeSwap,
        tokenHelper,
        newLiquidity,
        newReservedLiquidity,
        initialReserve.virtualBTCReserve,
        initialReserve.virtualTokenReserve,
    );

    popOriginSender();

    return reservation;
}

export async function swap(
    reservation: ReserveLiquidityHelper,
    transaction: Transaction | null,
): Promise<void> {
    pushOriginSender();

    // Setup transaction.
    // If no transaction is provided, we create a transaction that will
    // contain the exact amount of satoshis for each provider in the reservation.
    // Otherwise, we use the provided transaction that may have different amounts.
    const localTransaction = transaction !== null ? transaction : reservation.createTransaction();

    Blockchain.transaction = localTransaction;

    // Get initial balances and reserve
    const initialReserve = await LiquidityReserveHelper.create(nativeSwap, reservation.tokenHelper);
    const initialStakingBalance = await reservation.tokenHelper.getStakingContractBalance();
    const initialNativeSwapBalance = await reservation.tokenHelper.getNativeSwapContractBalance();
    const initialReserverBalance = await reservation.tokenHelper.getBalanceOf(reservation.reserver);

    const initialSnapshot = await getReservedProvidersSnapshot(reservation);

    // Execute the swap
    const result = await helper_swapNew(
        nativeSwap,
        reservation.tokenHelper.token.address,
        reservation.reserver,
        ENABLE_LOG,
    );

    // Decode swap events
    const swapEvents = decodeSwapEventsHelper(result.response.events);

    // Ensure swap was executed
    Assert.expect(swapEvents.swapExecutedEvent).toNotEqual(null);
    if (swapEvents.swapExecutedEvent === null) {
        throw new Error('Swap not executed.');
    }

    const finalSnapshot = await getReservedProvidersSnapshot(reservation);

    const transactionTotalAmount = getTransactionTotalAmount(localTransaction);
    // The used amount must match the provided amount of satoshis
    Assert.expect(swapEvents.swapExecutedEvent.amountIn).toEqual(transactionTotalAmount);

    if (transactionTotalAmount === reservation.totalSatoshis && !reservation.isExpired()) {
        Assert.expect(reservation.expectedAmountOut).toEqual(
            swapEvents.swapExecutedEvent.amountOut + swapEvents.swapExecutedEvent.totalFees,
        );
    }

    // Ensure the swap goes to the reserver
    Assert.expect(
        swapEvents.swapExecutedEvent.buyer.toString() === reservation.reserver.toString(),
    );

    if (reservation.isExpired()) {
        Assert.expect(swapEvents.reservationFallbackEvent).toNotEqual(null);
    }

    // Ensure the amount transferred to the reserver match
    const transferAmountReservation = getTransferAmount(
        swapEvents.transferredEvents,
        nativeSwapContractAddress,
        reservation.reserver,
    );
    Assert.expect(transferAmountReservation).toEqual(swapEvents.swapExecutedEvent.amountOut);

    // Ensure the new reserver balance match
    const newReserverBalance = await reservation.tokenHelper.getBalanceOf(reservation.reserver);
    Assert.expect(newReserverBalance).toEqual(initialReserverBalance + transferAmountReservation);

    // Get the amount transferred to the staking contract
    const transferAmountStaking = getTransferAmount(
        swapEvents.transferredEvents,
        nativeSwapContractAddress,
        stakingContractAddress,
    );

    // Process the ProviderActivated events
    await processProviderActivated(swapEvents.providerActivatedEvent);

    // Process the ProviderFulfilled events
    const fulfilledStakingAmount = await processProviderFulfilled(
        swapEvents.providerFulfilledEvents,
    );

    // Ensure the computed staking amount match the transferred amount
    const stakingAmount = fulfilledStakingAmount + swapEvents.swapExecutedEvent.totalFees;
    Assert.expect(transferAmountStaking).toEqual(stakingAmount);

    // Ensure the new balance of the staking contract is accurate
    const newStakingBalance = await reservation.tokenHelper.getStakingContractBalance();
    Assert.expect(newStakingBalance).toEqual(initialStakingBalance + stakingAmount);

    // Ensure the new balance of the nativeswap contract is accurate
    const newNativeSwapBalance = await reservation.tokenHelper.getNativeSwapContractBalance();
    Assert.expect(newNativeSwapBalance).toEqual(
        initialNativeSwapBalance - transferAmountStaking - transferAmountReservation,
    );

    // Ensure the liquidity reserve is accurate
    await assertCurrentLiquidityReserveHelper(
        nativeSwap,
        reservation.tokenHelper,
        initialReserve.liquidity - transferAmountStaking - transferAmountReservation,
        initialReserve.reservedLiquidity - reservation.expectedAmountOut,
        initialReserve.virtualBTCReserve,
        initialReserve.virtualTokenReserve - stakingAmount,
    );

    // Validate reserved vs swapped providers and check their status
    assertReservedSwapperProviders(initialSnapshot, finalSnapshot, reservation, swapEvents);

    Blockchain.transaction = null;

    popOriginSender();
}
