import { Assert, Blockchain, opnet, OPNetUnit, Transaction } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Address } from '@btc-vision/transaction';
import {
    helper_cancelLiquidityNew,
    helper_createPoolNew,
    helper_createTokenNew,
    helper_listLiquidityNew,
    helper_reserveNew,
    helper_swapNew,
} from '../utils/OperationHelperNew.js';
import { ProviderHelper } from './helpers/ProviderHelper.js';
import {
    assertNativeSwapBalanceHelper,
    assertProviderBalanceHelper,
    assertStakingBalanceHelper,
    TokenHelper,
} from './helpers/TokenHelper.js';
import {
    computeSlashing,
    expandBigIntTo18Decimals,
    expandNumberTo18Decimals,
} from './helpers/UtilsHelper.js';
import {
    assertCurrentLiquidityReserveHelper,
    LiquidityReserveHelper,
} from './helpers/LiquidityReserveHelper.js';
import {
    assertCreatePoolEventsHelper,
    decodeCreatePoolEventsHelper,
} from './helpers/CreatePoolEventsHelper.js';
import {
    assertListLiquidityEventsHelper,
    decodeListLiquidityEventsHelper,
} from './helpers/ListLiquidityEventsHelper.js';
import {
    assertCancelListLiquidityEventsHelper,
    decodeCancelListLiquidityEventsHelper,
} from './helpers/CancelListLiquidityEventsHelper.js';

import { ReserveLiquidityHelper } from './helpers/ReserveLiquidityHelper.js';
import { decodeReserveLiquidityEventsHelper } from './helpers/ReserveLiquidityEventsHelper.js';
import {
    IActivateProviderEvent,
    IProviderFulfilledEvent,
    IReservationPurgedEvent,
    ITransferEvent,
} from '../../contracts/NativeSwapTypes.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { decodeSwapEventsHelper } from './helpers/SwapEventsHelper.js';

const ENABLE_LOG: boolean = false;

await opnet('Native Swap - Track price and balance', async (vm: OPNetUnit) => {
    const nativeSwapOwnerAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapContractAddress: Address = Blockchain.generateRandomAddress();
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    let nativeSwap: NativeSwap;
    let tokenArray: TokenHelper[] = [];
    let providerArray: ProviderHelper[] = [];
    let reservationArray: ReserveLiquidityHelper[] = [];

    let origin: Address;
    let sender: Address;

    function pushOriginSender(): void {
        origin = Blockchain.txOrigin;
        sender = Blockchain.msgSender;
    }

    function popOriginSender(): void {
        Blockchain.txOrigin = origin;
        Blockchain.msgSender = sender;
    }

    function getProvider(providerId: bigint): ProviderHelper | null {
        const result = providerArray.find((p) => p.id === providerId);

        return result === undefined ? null : result;
    }

    function removeProvider(provider: ProviderHelper): void {
        Blockchain.log(`Removing provider: ${provider.id}`);
        const index = providerArray.indexOf(provider);

        if (index === -1) {
            throw new Error('Provider not found');
        }

        providerArray.splice(index, 1);
    }

    function getReservation(reservationId: bigint): ReserveLiquidityHelper | null {
        const result = reservationArray.find((r) => r.reservationId === reservationId);

        return result === undefined ? null : result;
    }

    async function initBlockchain(): Promise<void> {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
    }

    async function initNativeSwap(): Promise<void> {
        nativeSwap = new NativeSwap(nativeSwapOwnerAddress, nativeSwapContractAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        pushOriginSender();
        Blockchain.txOrigin = nativeSwapOwnerAddress;
        Blockchain.msgSender = nativeSwapOwnerAddress;
        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
        popOriginSender();
    }

    async function createTokens(): Promise<void> {
        for (let i = 0; i < 10; i++) {
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

    function disposeTokens(): void {
        for (let i = 0; i < 10; i++) {
            tokenArray[i].token.dispose();
        }

        tokenArray = [];
    }

    function getTransactionTotalAmount(transaction: Transaction): bigint {
        let total: bigint = 0n;

        for (let i = 0; i < transaction.outputs.length; i++) {
            total += transaction.outputs[i].value;
        }

        return total;
    }

    async function createPool(
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

    async function listLiquidity(
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

    async function relistLiquidity(
        provider: ProviderHelper,
        amountIn: bigint,
        priority: boolean,
    ): Promise<void> {
        pushOriginSender();

        // Get initial balances and reserve
        const initialReserve = await LiquidityReserveHelper.create(
            nativeSwap,
            provider.tokenHelper,
        );
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

    async function cancelLiquidity(provider: ProviderHelper): Promise<void> {
        pushOriginSender();

        // Get initial balances and reserve
        const initialReserve = await LiquidityReserveHelper.create(
            nativeSwap,
            provider.tokenHelper,
        );
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

        await assertCurrentLiquidityReserveHelper(
            nativeSwap,
            provider.tokenHelper,
            newLiquidity,
            newReservedLiquidity,
            initialReserve.virtualBTCReserve,
            initialReserve.virtualTokenReserve,
        );

        popOriginSender();
    }

    async function reserveLiquidity(
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

    async function swap(
        reservation: ReserveLiquidityHelper,
        transaction: Transaction | null,
    ): Promise<void> {
        pushOriginSender();

        // Setup transaction.
        // If no transaction is provided, we create a transaction that will
        // contain the exact amount of satoshis for each provider in the reservation.
        // Otherwise, we use the provided transaction that may have different amounts.
        const localTransaction =
            transaction !== null ? transaction : reservation.createTransaction();

        Blockchain.transaction = localTransaction;

        // Get initial balances and reserve
        const initialReserve = await LiquidityReserveHelper.create(
            nativeSwap,
            reservation.tokenHelper,
        );
        const initialStakingBalance = await reservation.tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance =
            await reservation.tokenHelper.getNativeSwapContractBalance();
        const initialReserverBalance = await reservation.tokenHelper.getBalanceOf(
            reservation.reserver,
        );

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
        Assert.expect(newReserverBalance).toEqual(
            initialReserverBalance + transferAmountReservation,
        );

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

        Blockchain.transaction = null;

        popOriginSender();
    }

    function getTransferAmount(
        transferEvents: ITransferEvent[],
        from: Address,
        to: Address,
    ): bigint {
        const transfer = transferEvents.find(
            (t) => t.from.toString() === from.toString() && t.to.toString() == to.toString(),
        );

        return transfer === undefined ? 0n : transfer.amount;
    }

    async function processProviderActivated(
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

    function processPurgedReservation(purgedReservationEvents: IReservationPurgedEvent[]): bigint {
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

    async function processProviderFulfilled(
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

            removeProvider(provider);
        }

        return transferToStakingAmount;
    }

    vm.beforeEach(async () => {
        await initBlockchain();
        await createTokens();
        await initNativeSwap();
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        disposeTokens();
        Blockchain.dispose();
    });

    await vm.it('', async () => {
        Blockchain.blockNumber = 1000n;
        const intialProvider: ProviderHelper = await createPool(
            tokenArray[0],
            expandNumberTo18Decimals(10000001),
            expandNumberTo18Decimals(17),
        );

        Blockchain.blockNumber += 10n;
        const provider1: ProviderHelper = await listLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            expandBigIntTo18Decimals(100000000n),
        );

        Blockchain.blockNumber += 2n;
        Blockchain.log('reservation 1');

        const reservation = await reserveLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            10000000n,
        );

        if (reservation === null) {
            throw new Error('Cannot reserve.');
        }

        Blockchain.blockNumber += 13n;
        Blockchain.log('swap');
        await swap(reservation, null);

        //!!! Adjust virtualtokenreserve in cancel and list

        /*
        Blockchain.blockNumber += 20n;

        Blockchain.log('reservation 2');
        const r3 = await LiquidityReserveHelper.create(nativeSwap, tokenArray[0]);
        r3.logToConsole();
        const reservation2 = await reserveLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            10000000n,
        );

        Blockchain.log('reservation 1-1');
        if (reservation !== null) {
            reservation.logToConsole();
        }

        Blockchain.log('reservation 2-1');
        if (reservation2 !== null) {
            reservation2.logToConsole();
            const r4 = await LiquidityReserveHelper.create(nativeSwap, tokenArray[0]);
            r4.logToConsole();
        }
        
 */
    });
});
