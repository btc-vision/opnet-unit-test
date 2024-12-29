import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';
import { gas2BTC, gas2Sat, gas2USD } from '../utils/TransactionUtils.js';

await opnet('Native Swap - Create Pool', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const satoshisIn: bigint = 1_000_000_000_000n; //100_000n  BTC 1_000_000_000_000n

    const floorPrice: bigint = 1000n;
    const initialLiquidity: bigint = 1000n;
    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const antiBotEnabledFor = 0;
    const antiBotMaximumTokensPerReservation = 0n;

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the OP_20 token
        token = new OP_20({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });

        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        await token.mint(userAddress, 10_000_000);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.approve(userAddress, nativeSwap.address, liquidityAmount);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should successfully set quote', async () => {
        Blockchain.tracePointers = false;

        const quote = await nativeSwap.createPool(
            tokenAddress,
            floorPrice,
            initialLiquidity,
            initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
        );

        console.log(quote);

        vm.debug(
            `Quote set! Gas cost: ${gas2Sat(quote.usedGas)}sat (${gas2BTC(quote.usedGas)} BTC, $${gas2USD(quote.usedGas)})`,
        );

        Blockchain.tracePointers = false;
    });

    await vm.it('should not set quote if already set', async () => {
        Blockchain.tracePointers = true;

        const quote = await nativeSwap.createPool(
            tokenAddress,
            floorPrice,
            initialLiquidity,
            initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
        );

        await Assert.expect(async () => {
            await nativeSwap.createPool(
                tokenAddress,
                floorPrice,
                initialLiquidity,
                initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
            );
        }).toThrow(`Base quote already set`);

        vm.debug(
            `Quote set! Gas cost: ${gas2Sat(quote.usedGas)}sat (${gas2BTC(quote.usedGas)} BTC, $${gas2USD(quote.usedGas)})`,
        );

        Blockchain.tracePointers = false;
    });
});
