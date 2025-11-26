import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    helper_createPool,
    helper_createToken,
    helper_getProviderDetails,
    helper_getReserve,
    helper_reserve,
    helper_swap,
} from '../utils/OperationHelper.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
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
            true,
            0,
        );

        Blockchain.blockNumber = 1002n;
        await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
        Blockchain.blockNumber = 1003n;
        await Assert.expect(async () => {
            await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
        }).toThrow(`NATIVE_SWAP: Reservation already swapped.`);
    });

    await vm.it('should revert when no satoshis sent when swapping', async () => {
        Blockchain.blockNumber = 1000n;
        const reserveAddress = Blockchain.generateRandomAddress();

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

        // Swap
        Blockchain.blockNumber = 1002n;
        await Assert.expect(async () => {
            createRecipientUTXOs([]);
            await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
        }).toThrow();
    });

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
        Assert.expect(reserveResult.expectedAmountOut).toEqual(14804520000000000000n);
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
        Assert.expect(getReserveResult2.reservedLiquidity).toEqual(14804520000000000000n);

        Blockchain.msgSender = liquidityOwner;
        Blockchain.txOrigin = liquidityOwner;
        const getProviderDetailsResult2 = await helper_getProviderDetails(
            nativeSwap,
            tokenAddress,
            false,
        );

        Assert.expect(getProviderDetailsResult2.liquidity).toEqual(1000000000000000000000000n);
        Assert.expect(getProviderDetailsResult2.reserved).toEqual(14804520000000000000n);

        // Swap
        Blockchain.blockNumber = 1002n;
        createRecipientUTXOs(decodedReservation.recipients);

        const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);

        const swapEvt = swapResult.response.events.find((event) => event.type === 'SwapExecuted');
        Assert.expect(swapEvt).toNotEqual(undefined);

        if (swapEvt) {
            const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(swapEvt.data);

            Assert.expect(decodedSwapEvent.amountIn).toEqual(100000n);
            Assert.expect(decodedSwapEvent.amountOut).toEqual(14774910960000000000n);

            const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);

            Assert.expect(getReserveResult3.reservedLiquidity).toEqual(
                getReserveResult1.reservedLiquidity,
            );

            Assert.expect(getReserveResult3.virtualTokenReserve).toEqual(999985195480000000000000n);
            Assert.expect(getReserveResult3.liquidity).toEqual(
                getReserveResult1.liquidity - expectedAmount,
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
            Assert.expect(stakingContractBalance).toEqual(29609040000000000n);

            const reserverBalance = await token.balanceOf(reserveAddress);
            Assert.expect(reserverBalance).toEqual(14774910960000000000n);
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
            Assert.expect(reserveResult.expectedAmountOut).toEqual(14804520000000000000n);
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
            Assert.expect(getReserveResult2.reservedLiquidity).toEqual(14804520000000000000n);

            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            const getProviderDetailsResult2 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult2.liquidity).toEqual(1000000000000000000000000n);
            Assert.expect(getProviderDetailsResult2.reserved).toEqual(14804520000000000000n);

            // Swap
            Blockchain.blockNumber = 1022n;

            const swapResult = await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);
            const expectedFees = 0n;

            const swapEvt = swapResult.response.events.find(
                (event) => event.type === 'SwapExecuted',
            );
            Assert.expect(swapEvt).toNotEqual(undefined);

            if (swapEvt) {
                const decodedSwapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                    swapEvt.data,
                );

                Assert.expect(decodedSwapEvent.amountIn).toEqual(100000n);
                Assert.expect(decodedSwapEvent.amountOut).toEqual(14774910960000000000n);

                const getReserveResult3 = await helper_getReserve(nativeSwap, token, false);
                Assert.expect(getReserveResult3.reservedLiquidity).toEqual(
                    getReserveResult1.reservedLiquidity,
                );

                Assert.expect(getReserveResult3.virtualTokenReserve).toEqual(
                    999985195480000000000000n,
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
                Assert.expect(stakingContractBalance).toEqual(29609040000000000n);

                const reserverBalance = await token.balanceOf(reserveAddress);
                Assert.expect(reserverBalance).toEqual(14774910960000000000n);
            }
        },
    );
});
