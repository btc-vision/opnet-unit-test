import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Address } from '@btc-vision/transaction';
import {
    helper_cancelLiquidityNew,
    helper_createPoolNew,
    helper_createTokenNew,
    helper_listLiquidityNew,
    helper_reserveNew,
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

import {
    generateReservationId,
    ReserveLiquidityHelper,
    ReserveLiquidityRecipientHelper,
} from './helpers/ReserveLiquidityHelper.js';
import { decodeReserveLiquidityEventsHelper } from './helpers/ReserveLiquidityEventsHelper.js';

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

    function getReservation(reserver: Address): ReserveLiquidityHelper | null {
        const result = reservationArray.find((r) => r.reserver === reserver);

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
        pushOriginSender();

        const provider: ProviderHelper = new ProviderHelper(providerAddress, tokenHelper, priority);

        const initialReserve = await LiquidityReserveHelper.create(nativeSwap, tokenHelper);
        const initialProviderLiquidity = provider.liquidity;
        const initialProviderBalance = await provider.getBalance();
        const initialStakingBalance = await tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance = await tokenHelper.getNativeSwapContractBalance();

        const result = await helper_listLiquidityNew(
            nativeSwap,
            provider.tokenHelper.token,
            provider.address,
            amountIn,
            provider.priority,
            provider.address,
            false,
            true,
            ENABLE_LOG,
        );

        let tax = 0n;

        if (provider.isPriority) {
            tax = (amountIn * 30n) / 1000n;
        }

        const decodedEvents = decodeListLiquidityEventsHelper(result.response.events);
        assertListLiquidityEventsHelper(
            nativeSwapContractAddress,
            stakingContractAddress,
            provider,
            amountIn,
            tax,
            decodedEvents,
        );

        await provider.update(nativeSwap);

        Assert.expect(provider.liquidity).toEqual(initialProviderLiquidity + amountIn - tax);

        await assertProviderBalanceHelper(provider, initialProviderBalance);
        await assertNativeSwapBalanceHelper(tokenHelper, initialNativeSwapBalance + amountIn - tax);
        await assertStakingBalanceHelper(tokenHelper, initialStakingBalance + tax);
        const slashing = computeSlashing(initialReserve.virtualTokenReserve, amountIn);

        await assertCurrentLiquidityReserveHelper(
            nativeSwap,
            tokenHelper,
            initialReserve.liquidity + amountIn - tax,
            initialReserve.reservedLiquidity,
            initialReserve.virtualBTCReserve,
            initialReserve.virtualTokenReserve + slashing + tax,
        );

        popOriginSender();
        providerArray.push(provider);

        return provider;
    }

    async function relistLiquidity(
        provider: ProviderHelper,
        amountIn: bigint,
        priority: boolean,
    ): Promise<void> {
        pushOriginSender();

        const initialReserve = await LiquidityReserveHelper.create(
            nativeSwap,
            provider.tokenHelper,
        );
        const initialProviderLiquidity = provider.liquidity;
        const initialProviderBalance = await provider.getBalance();
        const initialStakingBalance = await provider.tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance = await provider.tokenHelper.getNativeSwapContractBalance();

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

        let tax = 0n;

        if (provider.isPriority) {
            tax = (amountIn * 30n) / 1000n;
        }

        const decodedEvents = decodeListLiquidityEventsHelper(result.response.events);
        assertListLiquidityEventsHelper(
            nativeSwapContractAddress,
            stakingContractAddress,
            provider,
            amountIn,
            tax,
            decodedEvents,
        );

        await provider.update(nativeSwap);

        Assert.expect(provider.liquidity).toEqual(initialProviderLiquidity + amountIn - tax);

        await assertProviderBalanceHelper(provider, initialProviderBalance);
        await assertNativeSwapBalanceHelper(
            provider.tokenHelper,
            initialNativeSwapBalance + amountIn - tax,
        );
        await assertStakingBalanceHelper(provider.tokenHelper, initialStakingBalance + tax);
        const slashing = computeSlashing(initialReserve.virtualTokenReserve, amountIn);

        await assertCurrentLiquidityReserveHelper(
            nativeSwap,
            provider.tokenHelper,
            initialReserve.liquidity + amountIn - tax,
            initialReserve.reservedLiquidity,
            initialReserve.virtualBTCReserve,
            initialReserve.virtualTokenReserve + slashing + tax,
        );

        popOriginSender();
    }

    async function cancelLiquidity(provider: ProviderHelper): Promise<void> {
        pushOriginSender();

        const initialReserve = await LiquidityReserveHelper.create(
            nativeSwap,
            provider.tokenHelper,
        );
        const initialProviderLiquidity = provider.liquidity;
        const initialProviderBalance = await provider.getBalance();
        const initialStakingBalance = await provider.tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance = await provider.tokenHelper.getNativeSwapContractBalance();

        const result = await helper_cancelLiquidityNew(
            nativeSwap,
            provider.tokenHelper.token.address,
            provider.address,
            ENABLE_LOG,
        );

        const decodedEvents = decodeCancelListLiquidityEventsHelper(result.response.events);

        assertCancelListLiquidityEventsHelper(
            nativeSwapContractAddress,
            stakingContractAddress,
            provider,
            decodedEvents,
        );

        await provider.update(nativeSwap);

        Assert.expect(provider.liquidity).toEqual(0n);

        Assert.expect(decodedEvents.listingCancelledEvent).toNotEqual(null);

        if (decodedEvents.listingCancelledEvent !== null) {
            await assertProviderBalanceHelper(
                provider,
                initialProviderBalance +
                    decodedEvents.listingCancelledEvent.amount -
                    decodedEvents.listingCancelledEvent.penalty,
            );

            await assertNativeSwapBalanceHelper(
                provider.tokenHelper,
                initialNativeSwapBalance - decodedEvents.listingCancelledEvent.amount,
            );

            await assertStakingBalanceHelper(
                provider.tokenHelper,
                initialStakingBalance + decodedEvents.listingCancelledEvent.penalty,
            );
        }

        //!!! CHECK WHY WE NEVER DECREASE VIRTUAL TOKEN RESERVE in nativeswap

        await assertCurrentLiquidityReserveHelper(
            nativeSwap,
            provider.tokenHelper,
            initialReserve.liquidity - initialProviderLiquidity,
            initialReserve.reservedLiquidity,
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
        let reservation: ReserveLiquidityHelper | null = null;

        pushOriginSender();

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

        const decodedEvents = decodeReserveLiquidityEventsHelper(result.response.events);

        Assert.expect(decodedEvents.reservationCreatedEvent).toNotEqual(null);

        if (decodedEvents.reservationCreatedEvent !== null) {
            if (decodedEvents.reservationCreatedEvent.expectedAmountOut > 0n) {
                Assert.expect(decodedEvents.liquidityReservedEvents.length).toBeGreaterThan(0);
            }

            reservation = new ReserveLiquidityHelper(
                tokenHelper,
                reserver,
                generateReservationId(tokenHelper.token.address, reserver),
                decodedEvents.reservationCreatedEvent.totalSatoshis,
                decodedEvents.reservationCreatedEvent.expectedAmountOut,
                Blockchain.blockNumber,
            );

            for (let i = 0; i < decodedEvents.liquidityReservedEvents.length; i++) {
                const item = decodedEvents.liquidityReservedEvents[i];

                reservation.recipients.push(
                    new ReserveLiquidityRecipientHelper(
                        item.depositAddress,
                        item.amount,
                        item.providerId,
                    ),
                );

                const provider = getProvider(item.providerId);
                Assert.expect(provider).toNotEqual(null);

                if (provider !== null) {
                    await provider.update(nativeSwap);
                }
            }

            for (let i = 0; i < decodedEvents.purgedReservationEvents.length; i++) {
                //const purgedReservation= getReservation(decodedEvents.purgedReservationEvents[i].)
                Blockchain.log(`purge: ${decodedEvents.purgedReservationEvents[i].reservationId}`);
            }

            reservationArray.push(reservation);
        }

        popOriginSender();

        return reservation;
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

        const provider1: ProviderHelper = await listLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            expandBigIntTo18Decimals(100000000n),
        );

        const reservation = await reserveLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            10000000n,
        );

        if (reservation !== null) {
            reservation.logToConsole();
        }

        Blockchain.blockNumber += 20n;

        const reservation2 = await reserveLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            10000000n,
        );

        if (reservation2 !== null) {
            reservation2.logToConsole();
        }
    });
});
