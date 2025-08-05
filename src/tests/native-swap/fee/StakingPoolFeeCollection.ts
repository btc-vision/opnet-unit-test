import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { createRecipientUTXOs } from '../../utils/UTXOSimulator.js';
import { logSwapEvents, logSwapResult } from '../../utils/LoggerHelper.js';

await opnet('Native Swap - Staking Pool Fee Collection', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;

    const liquidityProviderAddress: Address = Blockchain.generateRandomAddress();
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    const floorPrice: bigint = 100000000000000n;

    /**
     * Helper: Create the NativeSwap pool with initial liquidity
     */
    async function createNativeSwapPool(floorPrice: bigint, initLiquidity: bigint): Promise<void> {
        // Approve NativeSwap to take tokens
        Blockchain.txOrigin = liquidityProviderAddress;
        Blockchain.msgSender = liquidityProviderAddress;
        await token.approve(liquidityProviderAddress, nativeSwap.address, initLiquidity);

        // Create the pool
        await nativeSwap.createPool({
            token: token.address,
            floorPrice: floorPrice,
            initialLiquidity: initLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 40,
        });

        Blockchain.blockNumber += 1n;
    }

    vm.beforeEach(async () => {
        Blockchain.blockNumber = 100n;

        // Reset blockchain state
        Blockchain.clearContracts();
        await Blockchain.init();

        Blockchain.txOrigin = liquidityProviderAddress;
        Blockchain.msgSender = liquidityProviderAddress;

        // Instantiate and register the OP_20 token
        token = new OP_20({
            file: 'MyToken',
            deployer: liquidityProviderAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });

        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        const totalSupply = 1_000_000n * 10n ** 18n;
        await token.mintRaw(liquidityProviderAddress, totalSupply);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(liquidityProviderAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await nativeSwap.setStakingContractAddress({ stakingContractAddress });

        // Add liquidity
        await createNativeSwapPool(floorPrice, totalSupply);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should collect fees for staking contract with simple number', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        const swapAmount = 10000n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: swapAmount,
            minimumAmountOut: 1n,
        });
        const preBalance = await token.balanceOf(userAddress);

        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            reservation.response.events,
        );
        createRecipientUTXOs(decodedReservation.recipients);

        Blockchain.blockNumber = Blockchain.blockNumber + 3n;

        const s = await nativeSwap.swap({
            token: tokenAddress,
        });

        const expectedFee = 3386294000000000n;
        const postBalance = await token.balanceOf(userAddress);
        const stakingPoolBalance = await token.balanceOf(stakingContractAddress);

        // Expect half the fee to go to the staking pool
        Assert.expect(stakingPoolBalance).toEqual(expectedFee / 2n);
        Assert.expect(postBalance).toEqual(preBalance + 1689760706000000000n);
    });

    /*
     TODO: Enable when we have a method to getFees for a given swap
    const swapAmountsToTest: bigint[] = [
        18576187456n,
        89876517346n,
        43789523978572n,
        8n * 10n ** 18n,
        13n * 10n ** 18n,
    ];

    for (let i = 0; i < swapAmountsToTest.length; i++) {
        await vm.it(`should collect fees for staking contract, test ${i}`, async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            const swapAmount = swapAmountsToTest[i];
            const reservation = await nativeSwap.reserve({
                token: tokenAddress,
                maximumAmountIn: swapAmount,
                minimumAmountOut: 1n,
                forLP: false,
            });
            const preBalance = await token.balanceOf(userAddress);

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reservation.response.events,
            );
            createRecipientUTXOs(decodedReservation.recipients);

            Blockchain.blockNumber = Blockchain.blockNumber + 1n;

            await nativeSwap.swap({
                token: tokenAddress,
                isSimulation: false,
            });

            // FIXME: Change to 50% of paid fee
            const expectedFee = (swapAmount * 20n) / 10000n;
            const expectedOutAmount = swapAmount - expectedFee;
            const postBalance = await token.balanceOf(userAddress);
            const stakingPoolBalance = await token.balanceOf(stakingContractAddress);

            Assert.expect(stakingPoolBalance).toEqual(expectedFee);
            Assert.expect(postBalance).toEqual(preBalance + expectedOutAmount);
        });
    }
    */
});
