import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    helper_createPool,
    helper_createToken,
    helper_getBalance,
    helper_getProviderDetails,
    helper_getReserve,
    helper_reserve,
    helper_swap,
} from '../utils/OperationHelper.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { ListLiquidityResult } from '../../contracts/NativeSwapTypes.js';
import { CSV_DURATION } from '../globals.js';

await opnet('Native Swap - Swap', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    const liquidityOwner: Address = Blockchain.generateRandomAddress();
    const floorPrice: bigint = 100000000000000n;
    const initialLiquidityAmount: number = 1_000_000;
    const initialLiquidityAmountExpanded: bigint =
        Blockchain.expandTo18Decimals(initialLiquidityAmount);
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    let tokenAddress: Address;

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(liquidityOwner, 18, 10_000_000);
        tokenAddress = token.address;

        await token.mint(userAddress, 10_000_000);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await helper_createPool(
            nativeSwap,
            token,
            liquidityOwner,
            liquidityOwner,
            initialLiquidityAmount,
            floorPrice,
            initialLiquidityAmountExpanded,
            100,
            false,
            true,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to swap if invalid token address', async () => {
        await Assert.expect(async () => {
            await helper_swap(nativeSwap, new Address(), Blockchain.generateRandomAddress(), false);
        }).toThrow(`Invalid token address`);

        await Assert.expect(async () => {
            await helper_swap(
                nativeSwap,
                Blockchain.DEAD_ADDRESS,
                Blockchain.generateRandomAddress(),
                false,
            );
        }).toThrow(`Invalid token address`);
    });

    await vm.it('should fail to swap when no pool created', async () => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await Assert.expect(async () => {
            await helper_swap(
                nativeSwap,
                Blockchain.generateRandomAddress(),
                Blockchain.generateRandomAddress(),
                false,
            );
        }).toThrow(`Pool does not exist for token.`);
    });

    await vm.it('should fail to swap when no reservation for a user', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_swap(nativeSwap, tokenAddress, Blockchain.generateRandomAddress(), false);
        }).toThrow(`NATIVE_SWAP: Reservation does not have any providers.`);
    });

    await vm.it(
        'should fail to swap when reservation is expired for a user and no utxo sent to provider',
        async () => {
            Blockchain.blockNumber = 1000n;
            const reserveAddress = Blockchain.generateRandomAddress();

            const result = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );

            Blockchain.blockNumber = 1011n;
            await Assert.expect(async () => {
                await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
            }).toThrow(`NATIVE_SWAP: No tokens purchased for expired reservation.`);
        },
    );

    await vm.it('should fail to swap when reservation is consumed in the same block', async () => {
        Blockchain.blockNumber = 1000n;
        const reserveAddress = Blockchain.generateRandomAddress();

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserveAddress,
            100000n,
            0n,
            false,
            false,
            false,
            0,
        );

        await Assert.expect(async () => {
            await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
        }).toThrow(`Reservation cannot be consumed in the same block`);
    });

    await vm.it(
        'should fail to swap when reservation is consumed before activation delay',
        async () => {
            Blockchain.blockNumber = 1000n;
            const reserveAddress = Blockchain.generateRandomAddress();

            await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                100000n,
                0n,
                false,
                false,
                false,
                3,
            );

            Blockchain.blockNumber = 1002n;
            await Assert.expect(async () => {
                await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
            }).toThrow(`Too early to consume reservation`);
        },
    );

    await vm.it('should fail to swap when reservation is consumed 2 times', async () => {
        Blockchain.blockNumber = 1000n;
        const reserveAddress = Blockchain.generateRandomAddress();

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserveAddress,
            100000n,
            0n,
            false,
            false,
            false,
            0,
        );

        Blockchain.blockNumber = 1002n;
        await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);

        Blockchain.blockNumber = 1003n;
        await Assert.expect(async () => {
            await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
        }).toThrow(`NATIVE_SWAP: Reservation already swapped.`);
    });

    await vm.it(
        'should restore initial provider liquidity when no satoshis sent when swapping',
        async () => {
            Blockchain.blockNumber = 1000n;
            const nativeSwapInitialBalance = await helper_getBalance(token, nativeSwap.address);

            const reserveAddress = Blockchain.generateRandomAddress();

            // Get initial reserve and provider values
            const getReserveResult1 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult1.reservedLiquidity).toEqual(0n);
            Assert.expect(getReserveResult1.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getReserveResult1.liquidity).toEqual(nativeSwapInitialBalance);

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult1 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult1.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getProviderDetailsResult1.reserved).toEqual(0n);

            // Reserve from initial provider
            const reserveResult = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                100000n,
                0n,
                false,
                false,
                false,
                0,
            );

            Assert.expect(reserveResult.expectedAmountOut).toEqual(16931470000000000000n);

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reserveResult.response.events,
            );

            Assert.expect(decodedReservation.recipients.length).toEqual(1);
            Assert.expect(decodedReservation.recipients[0].address).toEqual(
                liquidityOwner.toCSV(CSV_DURATION, Blockchain.network).address,
            );
            Assert.expect(decodedReservation.recipients[0].amount).toEqual(100000n);

            const getReserveResult2 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult2.reservedLiquidity).toEqual(16931470000000000000n);

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult2 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult2.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getProviderDetailsResult2.reserved).toEqual(16931470000000000000n);

            // Swap
            Blockchain.blockNumber = 1002n;
            createRecipientUTXOs([]);
            const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);

            const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                swapResult.response.events[swapResult.response.events.length - 1].data,
            );

            Assert.expect(decodedSwapEvent.amountIn).toEqual(0n);
            Assert.expect(decodedSwapEvent.amountOut).toEqual(0n);

            const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult3.reservedLiquidity).toEqual(
                getReserveResult1.reservedLiquidity,
            );
            Assert.expect(getReserveResult3.liquidity).toEqual(getReserveResult1.liquidity);

            const nativeFinalSwapBalance = await helper_getBalance(token, nativeSwap.address);
            Assert.expect(getReserveResult3.liquidity).toEqual(nativeFinalSwapBalance);

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult3 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );
            Assert.expect(getProviderDetailsResult3.liquidity).toEqual(
                getProviderDetailsResult1.liquidity,
            );
            Assert.expect(getProviderDetailsResult3.reserved).toEqual(
                getProviderDetailsResult3.reserved,
            );
        },
    );

    await vm.it(
        'should restore normal provider liquidity when no satoshis sent when swapping',
        async () => {
            Blockchain.blockNumber = 1000n;
            const nativeSwapInitialBalance = await helper_getBalance(token, nativeSwap.address);

            // Get initial reserve
            const getReserveResult1 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult1.reservedLiquidity).toEqual(0n);
            Assert.expect(getReserveResult1.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getReserveResult1.liquidity).toEqual(nativeSwapInitialBalance);

            const providerAddress = Blockchain.generateRandomAddress();
            const reserveAddress = Blockchain.generateRandomAddress();

            // List token
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.mint(providerAddress, 100_000_000);

            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;
            await token.increaseAllowance(providerAddress, nativeSwap.address, amountIn);

            const resp: ListLiquidityResult = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: providerAddress,
                network: Blockchain.network,
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
            });

            Assert.expect(resp.response.error).toBeUndefined();
            const nativeSwapListBalance = await helper_getBalance(token, nativeSwap.address);
            Assert.expect(nativeSwapListBalance).toEqual(nativeSwapInitialBalance + amountIn);

            const getReserveResult2 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult2.reservedLiquidity).toEqual(0n);
            Assert.expect(getReserveResult2.liquidity).toEqual(
                getReserveResult1.liquidity + amountIn,
            );
            Assert.expect(getReserveResult2.liquidity).toEqual(nativeSwapListBalance);

            Blockchain.blockNumber = 1002n;
            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;

            // Get reserve and provider values
            const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult3.reservedLiquidity).toEqual(0n);

            const getProviderDetailsResult1 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult1.liquidity).toEqual(amountIn);
            Assert.expect(getProviderDetailsResult1.reserved).toEqual(0n);

            Blockchain.blockNumber = 1003n;
            Blockchain.msgSender = reserveAddress;
            Blockchain.txOrigin = reserveAddress;

            // Reserve from normal provider
            const reserveResult = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                10000n,
                0n,
                false,
                false,
                false,
                0,
            );

            Assert.expect(reserveResult.expectedAmountOut).toEqual(1693993573500000000n);

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reserveResult.response.events,
            );

            Assert.expect(decodedReservation.recipients.length).toEqual(1);
            Assert.expect(decodedReservation.recipients[0].address).toEqual(
                providerAddress.toCSV(CSV_DURATION, Blockchain.network).address,
            );
            Assert.expect(decodedReservation.recipients[0].amount).toEqual(10000n);

            const getReserveResult4 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult4.reservedLiquidity).toEqual(1693993573500000000n);

            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;
            const getProviderDetailsResult2 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult2.liquidity).toEqual(1000000000000000000000n);
            Assert.expect(getProviderDetailsResult2.reserved).toEqual(1693993573500000000n);

            // Swap
            Blockchain.blockNumber = 1004n;
            Blockchain.msgSender = reserveAddress;
            Blockchain.txOrigin = reserveAddress;
            createRecipientUTXOs([]);
            const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);

            const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                swapResult.response.events[swapResult.response.events.length - 1].data,
            );

            Assert.expect(decodedSwapEvent.amountIn).toEqual(0n);
            Assert.expect(decodedSwapEvent.amountOut).toEqual(0n);

            const nativeSwapListAfterBalance = await helper_getBalance(token, nativeSwap.address);
            Assert.expect(nativeSwapListBalance).toEqual(nativeSwapListAfterBalance);

            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;
            const getReserveResult5 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult5.reservedLiquidity).toEqual(
                getReserveResult1.reservedLiquidity,
            );
            Assert.expect(getReserveResult5.liquidity).toEqual(getReserveResult2.liquidity);

            const getProviderDetailsResult3 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );
            Assert.expect(getProviderDetailsResult3.liquidity).toEqual(
                getProviderDetailsResult2.liquidity,
            );
            Assert.expect(getProviderDetailsResult3.reserved).toEqual(0n);
        },
    );

    await vm.it(
        'should restore priority provider liquidity when no satoshis sent when swapping',
        async () => {
            Blockchain.blockNumber = 1000n;
            const nativeSwapInitialBalance = await helper_getBalance(token, nativeSwap.address);
            const stakingInitialBalance = await helper_getBalance(token, stakingContractAddress);

            // Get initial reserve
            const getReserveResult1 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult1.reservedLiquidity).toEqual(0n);
            Assert.expect(getReserveResult1.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getReserveResult1.liquidity).toEqual(nativeSwapInitialBalance);
            Assert.expect(stakingInitialBalance).toEqual(0n);

            const providerAddress = Blockchain.generateRandomAddress();
            const reserveAddress = Blockchain.generateRandomAddress();

            // List token
            const amountIn = Blockchain.expandTo18Decimals(1000);
            const tax = 30000000000000000000n;
            await token.mint(providerAddress, 100_000_000);

            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;
            await token.increaseAllowance(providerAddress, nativeSwap.address, amountIn);

            const resp: ListLiquidityResult = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: providerAddress,
                network: Blockchain.network,
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            Assert.expect(resp.response.error).toBeUndefined();
            const stakingListBalance = await helper_getBalance(token, stakingContractAddress);
            Assert.expect(stakingListBalance).toEqual(stakingInitialBalance + tax);

            const nativeSwapListBalance = await helper_getBalance(token, nativeSwap.address);
            Assert.expect(nativeSwapListBalance).toEqual(nativeSwapInitialBalance + amountIn - tax);

            const getReserveResult2 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult2.reservedLiquidity).toEqual(0n);
            Assert.expect(getReserveResult2.liquidity).toEqual(
                getReserveResult1.liquidity + amountIn - tax,
            );
            Assert.expect(getReserveResult2.liquidity).toEqual(nativeSwapListBalance);

            Blockchain.blockNumber = 1002n;
            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;

            // Get initial reserve and provider values
            const getProviderDetailsResult1 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult1.liquidity).toEqual(970000000000000000000n);
            Assert.expect(getProviderDetailsResult1.reserved).toEqual(0n);

            Blockchain.blockNumber = 1003n;
            Blockchain.msgSender = reserveAddress;
            Blockchain.txOrigin = reserveAddress;

            // Reserve from priority provider
            const reserveResult = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                10000n,
                0n,
                false,
                false,
                false,
                0,
            );

            Assert.expect(reserveResult.expectedAmountOut).toEqual(1694044367910000000n);

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reserveResult.response.events,
            );

            Assert.expect(decodedReservation.recipients.length).toEqual(1);
            Assert.expect(decodedReservation.recipients[0].address).toEqual(
                providerAddress.toCSV(CSV_DURATION, Blockchain.network).address,
            );
            Assert.expect(decodedReservation.recipients[0].amount).toEqual(10000n);

            const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult3.reservedLiquidity).toEqual(1694044367910000000n);

            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;
            const getProviderDetailsResult2 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult2.liquidity).toEqual(970000000000000000000n);
            Assert.expect(getProviderDetailsResult2.reserved).toEqual(1694044367910000000n);

            // Swap
            Blockchain.blockNumber = 1004n;
            Blockchain.msgSender = reserveAddress;
            Blockchain.txOrigin = reserveAddress;
            createRecipientUTXOs([]);
            const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);

            const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                swapResult.response.events[swapResult.response.events.length - 1].data,
            );

            Assert.expect(decodedSwapEvent.amountIn).toEqual(0n);
            Assert.expect(decodedSwapEvent.amountOut).toEqual(0n);

            const nativeSwapFinalBalance = await helper_getBalance(token, nativeSwap.address);
            Assert.expect(nativeSwapListBalance).toEqual(nativeSwapFinalBalance);

            const stakingFinalBalance = await helper_getBalance(token, stakingContractAddress);
            Assert.expect(stakingListBalance).toEqual(stakingFinalBalance);

            Blockchain.msgSender = providerAddress;
            Blockchain.txOrigin = providerAddress;
            const getReserveResult4 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult4.reservedLiquidity).toEqual(
                getReserveResult2.reservedLiquidity,
            );
            Assert.expect(getReserveResult4.liquidity).toEqual(getReserveResult2.liquidity);

            const getProviderDetailsResult3 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );
            Assert.expect(getProviderDetailsResult3.liquidity).toEqual(
                getProviderDetailsResult1.liquidity,
            );
            Assert.expect(getProviderDetailsResult3.reserved).toEqual(
                getProviderDetailsResult3.reserved,
            );
        },
    );

    await vm.it('should complete swap successfully with the initial provider', async () => {
        Blockchain.blockNumber = 1000n;
        const reserveAddress = Blockchain.generateRandomAddress();

        // Get initial reserve and provider values
        const getReserveResult1 = await helper_getReserve(nativeSwap, token, false);
        Assert.expect(getReserveResult1.reservedLiquidity).toEqual(0n);

        Blockchain.msgSender = liquidityOwner;
        Blockchain.txOrigin = liquidityOwner;
        const getProviderDetailsResult1 = await helper_getProviderDetails(
            nativeSwap,
            tokenAddress,
            false,
        );
        Assert.expect(getProviderDetailsResult1.liquidity).toEqual(1000000000000000000000000n);
        Assert.expect(getProviderDetailsResult1.reserved).toEqual(0n);

        // Reserve from initial provider
        const reserveResult = await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserveAddress,
            100000n,
            0n,
            false,
            false,
            true,
            0,
        );
        Assert.expect(reserveResult.expectedAmountOut).toEqual(16931470000000000000n);
        const expectedAmount = reserveResult.expectedAmountOut;

        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            reserveResult.response.events,
        );

        Assert.expect(decodedReservation.recipients.length).toEqual(1);
        Assert.expect(decodedReservation.recipients[0].address).toEqual(
            liquidityOwner.toCSV(CSV_DURATION, Blockchain.network).address,
        );
        Assert.expect(decodedReservation.recipients[0].amount).toEqual(100000n);

        const getReserveResult2 = await helper_getReserve(nativeSwap, token, false);
        Assert.expect(getReserveResult2.reservedLiquidity).toEqual(16931470000000000000n);

        Blockchain.msgSender = liquidityOwner;
        Blockchain.txOrigin = liquidityOwner;
        const getProviderDetailsResult2 = await helper_getProviderDetails(
            nativeSwap,
            tokenAddress,
            false,
        );

        Assert.expect(getProviderDetailsResult2.liquidity).toEqual(1000000000000000000000000n);
        Assert.expect(getProviderDetailsResult2.reserved).toEqual(16931470000000000000n);

        // Swap
        Blockchain.blockNumber = 1002n;
        createRecipientUTXOs(decodedReservation.recipients);

        const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
        const expectedFees = 33862940000000000n;

        const swapEvt = swapResult.response.events.find((event) => event.type === 'SwapExecuted');
        Assert.expect(swapEvt).toNotEqual(undefined);

        if (swapEvt) {
            const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(swapEvt.data);

            Assert.expect(decodedSwapEvent.amountIn).toEqual(100000n);
            Assert.expect(decodedSwapEvent.amountOut).toEqual(expectedAmount - expectedFees);

            const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult3.reservedLiquidity).toEqual(
                getReserveResult1.reservedLiquidity,
            );

            Assert.expect(getReserveResult3.virtualTokenReserve).toEqual(
                getReserveResult1.virtualTokenReserve - expectedFees,
            );

            Assert.expect(getReserveResult3.liquidity).toEqual(
                getReserveResult1.liquidity - expectedFees - (expectedAmount - expectedFees),
            );

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult3 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );
            Assert.expect(getProviderDetailsResult3.liquidity).toEqual(
                getProviderDetailsResult1.liquidity - expectedAmount,
            );
            Assert.expect(getProviderDetailsResult3.reserved).toEqual(
                getProviderDetailsResult3.reserved,
            );

            const stakingContractBalance = await token.balanceOf(stakingContractAddress);
            Assert.expect(stakingContractBalance).toEqual(expectedFees);

            const reserverBalance = await token.balanceOf(reserveAddress);
            Assert.expect(reserverBalance).toEqual(expectedAmount - expectedFees);
        }
    });

    await vm.it(
        'should complete swap successfully with the initial provider and expired reservation',
        async () => {
            Blockchain.blockNumber = 1000n;
            const reserveAddress = Blockchain.generateRandomAddress();

            // Get initial reserve and provider values
            const getReserveResult1 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult1.reservedLiquidity).toEqual(0n);

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult1 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );
            Assert.expect(getProviderDetailsResult1.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getProviderDetailsResult1.reserved).toEqual(0n);

            // Reserve from initial provider
            const reserveResult = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                100000n,
                0n,
                false,
                false,
                true,
                0,
            );
            Assert.expect(reserveResult.expectedAmountOut).toEqual(16931470000000000000n);
            const expectedAmount = reserveResult.expectedAmountOut;

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reserveResult.response.events,
            );

            Assert.expect(decodedReservation.recipients.length).toEqual(1);
            Assert.expect(decodedReservation.recipients[0].address).toEqual(
                liquidityOwner.toCSV(CSV_DURATION, Blockchain.network).address,
            );
            Assert.expect(decodedReservation.recipients[0].amount).toEqual(100000n);

            const getReserveResult2 = await helper_getReserve(nativeSwap, token, false);
            Assert.expect(getReserveResult2.reservedLiquidity).toEqual(16931470000000000000n);

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult2 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult2.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getProviderDetailsResult2.reserved).toEqual(16931470000000000000n);

            // Swap
            Blockchain.blockNumber = 1022n;

            const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
            const expectedFees = 33862940000000000n;

            const swapEvt = swapResult.response.events.find(
                (event) => event.type === 'SwapExecuted',
            );
            Assert.expect(swapEvt).toNotEqual(undefined);

            if (swapEvt) {
                const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                    swapEvt.data,
                );

                Assert.expect(decodedSwapEvent.amountIn).toEqual(100000n);
                Assert.expect(decodedSwapEvent.amountOut).toEqual(expectedAmount - expectedFees);

                const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);
                Assert.expect(getReserveResult3.reservedLiquidity).toEqual(
                    getReserveResult1.reservedLiquidity,
                );

                Assert.expect(getReserveResult3.virtualTokenReserve).toEqual(
                    getReserveResult1.virtualTokenReserve - expectedFees,
                );

                Assert.expect(getReserveResult3.liquidity).toEqual(
                    getReserveResult1.liquidity - expectedFees - (expectedAmount - expectedFees),
                );

                Blockchain.msgSender = liquidityOwner;
                Blockchain.txOrigin = liquidityOwner;
                const getProviderDetailsResult3 = await helper_getProviderDetails(
                    nativeSwap,
                    tokenAddress,
                    false,
                );
                Assert.expect(getProviderDetailsResult3.liquidity).toEqual(
                    getProviderDetailsResult1.liquidity - expectedAmount,
                );
                Assert.expect(getProviderDetailsResult3.reserved).toEqual(
                    getProviderDetailsResult3.reserved,
                );

                const stakingContractBalance = await token.balanceOf(stakingContractAddress);
                Assert.expect(stakingContractBalance).toEqual(expectedFees);

                const reserverBalance = await token.balanceOf(reserveAddress);
                Assert.expect(reserverBalance).toEqual(expectedAmount - expectedFees);
            }
        },
    );
});
