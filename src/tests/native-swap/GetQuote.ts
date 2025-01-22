import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';

await opnet('Native Swap - Get Quote', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    async function createZeroLiquidityPool(): Promise<void> {
        const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
        const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.approve(userAddress, nativeSwap.address, liquidityAmount);

        const quote = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: 1000n,
            initialLiquidity: 1000n,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 4000,
        });

        Assert.expect(quote.result).toEqual(true);
    }

    async function createDefaultLiquidityPool(): Promise<void> {
        const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
        const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.approve(userAddress, nativeSwap.address, liquidityAmount);

        const quote = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: 100n,
            initialLiquidity: 2000n,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 4000,
        });

        Assert.expect(quote.result).toEqual(true);
    }

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
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should revert when invalid token address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: new Address(),
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);

        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: Blockchain.DEAD_ADDRESS,
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);

        //await Assert.expect(async () => {
        //await nativeSwap.getQuote({
        //    token: Blockchain.generateRandomAddress(),
        //    satoshisIn: 10n,
        //});
        //}).toThrow(`NATIVE_SWAP: Invalid token address`);
    });

    await vm.it('should revert when maximum amount is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 0n,
            });
        }).toThrow(`NATIVE_SWAP: Maximum amount in cannot be zero`);
    });

    await vm.it('should revert when virtualBTCReserve is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 1000n,
            });
        }).toThrow(`NOT_ENOUGH_LIQUIDITY`);
    });

    await vm.it(
        'should return the values when liquidity is greater than the number of tokens for the given amount',
        async () => {
            await createDefaultLiquidityPool();

            const getQuoteResult = await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 500n,
            });

            Blockchain.log(`---- Pool ----`);
            Blockchain.log(`floorprice: 100`);
            Blockchain.log(`initialliquidity: 2000`);

            Blockchain.log(`---- Reserve ----`);
            const reserveResult = await nativeSwap.getReserve({
                token: token.address,
            });

            Blockchain.log(`Liquidity: ${reserveResult.liquidity}`);
            Blockchain.log(`ReservedLiquidity: ${reserveResult.reservedLiquidity}`);
            Blockchain.log(`VirtualBTCReserve: ${reserveResult.virtualBTCReserve}`);
            Blockchain.log(`VirtualTokenReserve: ${reserveResult.virtualTokenReserve}`);

            Blockchain.log(`---- Quote ----`);
            Blockchain.log(`satoshiin: 500`);
            Blockchain.log(`tokensOut: ${getQuoteResult.tokensOut}`);
            Blockchain.log(`requiredSatoshis: ${getQuoteResult.requiredSatoshis}`);
            Blockchain.log(`price: ${getQuoteResult.price}`);
        },
    );
});
