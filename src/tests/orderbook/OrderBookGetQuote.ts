import { Address } from '@btc-vision/transaction';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';
import { tickSpacing } from './extern/AddLiquidityExternalConstants.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';

const receiver: Address = Blockchain.generateRandomAddress();

function safeBigIntDivision(numerator: bigint, denominator: bigint, precision: bigint): bigint {
    return (numerator * precision) / denominator;
}

await opnet('OrderBook Contract getQuote Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver;

    const precision: bigint = 10n ** 18n;
    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the OP_20 token
        token = new OP_20({
            fileName: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: 18,
        });

        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        const mintAmount: number = 100_000_000;
        await token.mint(userAddress, mintAmount);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        Blockchain.register(orderBook);
        await orderBook.init();

        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should return a valid quote for available liquidity', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const targetPriceLevel = 50_000n; // 50,000 satoshis for 1 token.
        const minimumLiquidityPerTick = 100n;

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        // Add liquidity to the order book
        await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            maximumAmountIn,
            targetPriceLevel,
        );

        // Get a quote for the specified satoshis input
        const satoshisIn = 500_000n; // 500,000 satoshis (0.005 BTC)
        const callResponse = await orderBook.getQuote(
            tokenAddress,
            satoshisIn,
            minimumLiquidityPerTick,
        );

        // Expected tokens based on price level
        const expectedTokensOut: bigint = safeBigIntDivision(
            satoshisIn,
            targetPriceLevel,
            precision,
        );

        Assert.expect(callResponse.response.error).toBeUndefined();
        Assert.expect(callResponse.result.expectedAmountOut).toEqual(expectedTokensOut);

        const gasUsed = callResponse.response.usedGas;
        vm.success(`Get quote gas used: ${gasUsed}`);
    });

    await vm.it('should thrown when no liquidity for a quote is available', async () => {
        const satoshisIn = 500_000n; // 500,000 satoshis

        await Assert.expect(async () => {
            await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        }).toThrow('Insufficient liquidity to provide a quote');
    });

    await vm.it('should fail when requested amount is below minimum trade size', async () => {
        const minimumTradeSize = 100n; // 10000 satoshis as per contract
        const satoshisIn = minimumTradeSize - 1n; // Below minimum trade size

        // Call getQuote with an amount below the minimum
        await Assert.expect(async () => {
            await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        }).toThrow('Requested amount is below minimum trade size');
    });

    await vm.it('should handle multiple ticks and provide correct quote', async () => {
        const liquidityAmount: bigint = Blockchain.expandTo18Decimals(15000); // 5 tokens with 18 decimals

        // Approve and add liquidity across multiple price levels
        await token.approve(userAddress, orderBook.address, liquidityAmount * 3n);

        const priceLevels = [500n, 5000n, 15000n]; // Price levels in satoshis per token

        for (const priceLevel of priceLevels) {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                liquidityAmount,
                priceLevel,
            );
        }

        // Request quote across multiple ticks
        const satoshisIn = 100_000_000n; // 1 BTC
        const callResponse = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);

        // Calculate expected tokens considering price levels
        let remainingSatoshis = satoshisIn;
        let expectedTokensOut = 0n;

        for (const priceLevel of priceLevels) {
            // Compute maximum tokens that can be bought at this tick
            let tokensAtTick = (remainingSatoshis * precision) / priceLevel;

            // Limit tokensAtTick to the available liquidity
            if (tokensAtTick > liquidityAmount) {
                tokensAtTick = liquidityAmount;
            }

            // Compute satoshis used
            const satoshisUsed = (tokensAtTick * priceLevel) / precision;

            expectedTokensOut += tokensAtTick;

            if (satoshisUsed >= remainingSatoshis) {
                remainingSatoshis = 0n;
            } else {
                remainingSatoshis -= satoshisUsed;
            }

            if (remainingSatoshis <= 0) break;
        }

        // Compare the result from getQuote
        const quoteResult = callResponse.result; // Expected to be in smallest token units
        Assert.expect(quoteResult.expectedAmountOut).toEqual(expectedTokensOut);

        vm.log(`Expected tokens out: ${expectedTokensOut}`);
        vm.log(`Quote result: (expectedAmountIn) ${quoteResult.expectedAmountIn}`);
        vm.log(`Quote result: (expectedAmountOut) ${quoteResult.expectedAmountOut}`);
    });

    await vm.it('should return a correct quote even for partial liquidity fill', async () => {
        const amount: number = 250;
        const liquidityAmount = Blockchain.expandTo18Decimals(amount);
        const targetPriceLevel = 50_000n; // 50,000 satoshis per token

        const satoshisIn: bigint = BigInt(liquidityAmount) * targetPriceLevel;

        // Approve tokens for the OrderBook contract
        await token.approve(userAddress, orderBook.address, liquidityAmount);

        // Add partial liquidity to the OrderBook
        await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            liquidityAmount,
            targetPriceLevel,
        );

        // Call getQuote
        const callResponse = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);

        // Assert that the returned quote matches the available liquidity
        Assert.expect(callResponse.result.expectedAmountOut).toEqual(liquidityAmount);

        // Optional: Log gas used for the getQuote call
        const gasUsed = callResponse.response.usedGas;
        vm.success(`Get quote gas used: ${gasUsed}`);
    });

    await vm.it('should fail for an invalid token address', async () => {
        const invalidTokenAddress = Address.dead();
        const satoshisIn = BigInt(500000);

        await Assert.expect(async () => {
            await orderBook.getQuote(invalidTokenAddress, satoshisIn, 1n);
        }).toThrow('Invalid token address');
    });

    // Test for adding 1000 different positions and comparing gas usage

    await vm.it('should add 100 different positions and compare gas usage', async () => {
        const numberOfTicks = 100;
        const maximumAmountIn = 10n ** 18n;

        // Approve enough tokens
        await token.approve(
            userAddress,
            orderBook.address,
            1000000000000000000000000000000000000000000000000n,
        );

        // Now, add the rest of the ticks
        for (let i = 0; i < numberOfTicks; i++) {
            const tokenOwner: Address = Blockchain.generateRandomAddress();
            const randomLiquidityAmount = BigInt(i + 1) * 10n * maximumAmountIn;

            await orderBook.addLiquidity(
                tokenAddress,
                tokenOwner.p2tr(Blockchain.network),
                randomLiquidityAmount,
                BigInt((i + 1) * tickSpacing) * 5n,
            );
        }

        Blockchain.tracePointers = true;

        const startedAt = Date.now();
        const satoshisIn = 100_000_000n; // 1 BTC.
        const callResponse = await orderBook.getQuote(tokenAddress, satoshisIn, 1000n);

        Blockchain.tracePointers = false;

        Assert.expect(callResponse.response.error).toBeUndefined();

        console.log(
            `Quote returned ${callResponse.result.expectedAmountOut} (${callResponse.result.expectedAmountOut / precision}) tokens for ${satoshisIn} satoshis`,
        );

        vm.info(
            `Get quote gas used: ${callResponse.response.usedGas} - Time taken: ${Date.now() - startedAt}ms`,
        );
    });
});
