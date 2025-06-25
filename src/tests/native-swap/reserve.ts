import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    helper_createPool,
    helper_createToken,
    helper_getReserve,
    helper_reserve,
} from '../utils/OperationHelper.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';

await opnet('Native Swap - Reserve', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

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
            40,
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

    await vm.it('should fail to reserve if invalid token address', async () => {
        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                new Address(),
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`Invalid token address`);

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                Blockchain.DEAD_ADDRESS,
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`Invalid token address`);
    });

    await vm.it('should fail to reserve when no pool created', async () => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                Blockchain.generateRandomAddress(),
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`Pool does not exist for token.`);
    });

    await vm.it('should fail to reserve when maximum amount is 0', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                0n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: Maximum amount in cannot be zero.`);
    });

    await vm.it('should fail to reserve our own liquidity', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                liquidityOwner,
                100000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: You cannot reserve your own liquidity.`);
    });

    await vm.it('should fail to reserve when activation delay is invalid', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                10,
            );
        }).toThrow(`NATIVE_SWAP: Activation delay cannot be greater than`);
    });

    await vm.it('should fail to reserve when insufficient fees collected', async () => {
        Blockchain.blockNumber = 1000n;

        await nativeSwap.setFees({
            reservationBaseFee: 20000n,
            priorityQueueBaseFee: 20000n,
        });

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(`NATIVE_SWAP: Insufficient fees collected.`);
    });

    await vm.it('should fail to reserve when user is timed out', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber++;

        for (let i = 0; i < 6; i++) {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
            Blockchain.blockNumber++;
        }

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(`NATIVE_SWAP: User is timed out.`);
    });

    await vm.it('should allow a user to reserve again after the timeout period', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber++;

        for (let i = 0; i < 10; i++) {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
            Blockchain.blockNumber++;
        }

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );
    });

    await vm.it('should fail to reserve when reservation has not been purged', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber += 8n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(
            `NATIVE_SWAP: You may not reserve at this time. Your previous reservation has not been purged yet. Please try again later.`,
        );
    });

    await vm.it('should fail to reserve when already an active reservation', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber += 2n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(
            `NATIVE_SWAP: You already have an active reservation. Swap or wait for expiration before creating another`,
        );
    });
});
