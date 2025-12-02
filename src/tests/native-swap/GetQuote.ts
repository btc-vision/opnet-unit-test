import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    helper_createPool,
    helper_createToken,
    helper_getQuote,
    helper_reserve,
    helper_swap,
} from '../utils/OperationHelper.js';

await opnet('Native Swap - Get Quote', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    let tokenAddress: Address;

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(userAddress, 18, 10_000_000);
        tokenAddress = token.address;

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
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
                token: new Address(),
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);
    });

    await vm.it('should revert when token is dead address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: Blockchain.DEAD_ADDRESS,
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);
    });

    await vm.it('should revert when no pool created', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Pool does not exist for token`);
    });

    await vm.it('should revert when maximum amount is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 0n,
            });
        }).toThrow(`NATIVE_SWAP: Maximum amount in cannot be zero`);
    });

    await vm.it('should scale token price correctly', async () => {
        Blockchain.blockNumber = 1000n;
        const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
        const provider: Address = Blockchain.generateRandomAddress();

        await helper_createPool(
            nativeSwap,
            token,
            userAddress,
            initialLiquidityProvider,
            100000,
            1n,
            1000000n,
            100,
            false,
        );

        await helper_reserve(nativeSwap, tokenAddress, provider, 10000n, 0n, false, false, true);

        Blockchain.blockNumber = Blockchain.blockNumber + 3n;
        await helper_swap(nativeSwap, tokenAddress, provider, false);

        const quote = await helper_getQuote(nativeSwap, token, 1000n, false);
        Assert.expect(quote.tokensOut).toEqual(1436n);
    });

    await vm.it(
        'should return the values when liquidity is greater than the number of tokens for the given amount',
        async () => {
            Blockchain.blockNumber = 1000n;
            await helper_createPool(
                nativeSwap,
                token,
                userAddress,
                Blockchain.generateRandomAddress(),
                1000,
                10n,
                2000000n,
                60,
                false,
            );

            const getQuoteResult = await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 500n,
            });

            Assert.expect(getQuoteResult.price / getQuoteResult.scale).toEqual(14n);
            Assert.expect(getQuoteResult.requiredSatoshis).toEqual(500n);
            Assert.expect(getQuoteResult.tokensOut).toEqual(7402n);
        },
    );

    await vm.it(
        'should return a capped values when liquidity is smaller than the number of tokens for the given amount',
        async () => {
            Blockchain.blockNumber = 1000n;
            await helper_createPool(
                nativeSwap,
                token,
                userAddress,
                Blockchain.generateRandomAddress(),
                1000,
                10n,
                2000000n,
                60,
                false,
            );

            const getQuoteResult = await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 1700000n,
            });

            Assert.expect(getQuoteResult.price / getQuoteResult.scale).toEqual(14n);
            Assert.expect(getQuoteResult.requiredSatoshis).toEqual(135094n);
            Assert.expect(getQuoteResult.tokensOut).toEqual(2000000n);
        },
    );

    await vm.it(
        'should return a capped values when liquidity is smaller than the number of tokens and there is reservation for the given amount',
        async () => {
            Blockchain.blockNumber = 1000n;
            await helper_createPool(
                nativeSwap,
                token,
                userAddress,
                Blockchain.generateRandomAddress(),
                1000,
                10n,
                2000000n,
                60,
                false,
            );

            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                10000n,
                0n,
                false,
                false,
                true,
            );

            const result = await helper_getQuote(nativeSwap, token, 1700000n, false);

            Assert.expect(result.price / result.scale).toEqual(14n);
            Assert.expect(result.requiredSatoshis).toEqual(125094n);
            Assert.expect(result.tokensOut).toEqual(1851955n);
        },
    );
});
