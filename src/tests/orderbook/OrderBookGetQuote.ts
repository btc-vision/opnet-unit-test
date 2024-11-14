import { Address } from '@btc-vision/transaction';
import { Blockchain } from '../../blockchain/Blockchain.js';
import { Assert } from '../../opnet/unit/Assert.js';
import { opnet, OPNetUnit } from '../../opnet/unit/OPNetUnit.js';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';
import { OP_20 } from '../../contracts/generic/OP_20.js';
import { tickSpacing } from './extern/AddLiquidityExternalConstants.js';

const receiver: Address = Blockchain.generateRandomAddress();

function safeBigIntDivision(numerator: bigint, denominator: bigint, precision: bigint): bigint {
    return (numerator * precision) / denominator;
}

await opnet('OrderBook Contract getQuote Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver;

    const precision: bigint = 1_000_000n;
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
        const mintAmount: number = 10000000;
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
        const targetPriceLevel = BigInt(50_000); // 50,000 satoshis
        const slippage = 100; // 1%
        const invalidityPeriod = 10; // 10 blocks

        const minimumLiquidityPerTick = 100n;

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        // Add liquidity to the order book
        await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            maximumAmountIn,
            targetPriceLevel,
            slippage,
            invalidityPeriod,
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
        Assert.expect(callResponse.result).toEqual(expectedTokensOut / precision);

        const gasUsed = callResponse.response.usedGas;
        vm.success(`Get quote gas used: ${gasUsed}`);
    });

    await vm.it('should thrown when no liquidity for a quote is available', async () => {
        const satoshisIn = 500_000n; // 500,000 satoshis

        await Assert.expect(async () => {
            await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        }).toThrow('No initialized tick found');
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
        const liquidityAmount: bigint = Blockchain.expandTo18Decimals(500);
        const slippage = 100; // 1%
        const invalidityPeriod = 10; // 10 blocks

        // Approve and add liquidity across multiple price levels
        await token.approve(userAddress, orderBook.address, liquidityAmount * 3n);

        const priceLevels = [50n, 60n, 70n];

        for (const priceLevel of priceLevels) {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                liquidityAmount,
                priceLevel,
                slippage,
                invalidityPeriod,
            );
        }

        // Request quote across multiple ticks
        const satoshisIn = 2000000n; // 2,000,000 satoshis
        const callResponse = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);

        // Calculate expected tokens considering price levels
        let remainingSatoshis = satoshisIn;
        let expectedTokensOut = 0n;

        for (const priceLevel of priceLevels) {
            const tokensAtTick = remainingSatoshis / priceLevel;
            expectedTokensOut += tokensAtTick;
            remainingSatoshis -= tokensAtTick * priceLevel;
            if (remainingSatoshis <= 0) break;
        }

        Assert.expect(callResponse.result).toEqual(expectedTokensOut);
    });

    await vm.it('should return a correct quote even for partial liquidity fill', async () => {
        const amount: number = 250;
        const liquidityAmount = Blockchain.expandTo18Decimals(amount);
        const targetPriceLevel = 50_000n; // 50,000 satoshis per token
        const slippage = 100; // 1%
        const invalidityPeriod = 10; // 10 blocks

        const satoshisIn: bigint = BigInt(liquidityAmount) * targetPriceLevel;

        // Approve tokens for the OrderBook contract
        await token.approve(userAddress, orderBook.address, liquidityAmount);

        // Add partial liquidity to the OrderBook
        await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            liquidityAmount,
            targetPriceLevel,
            slippage,
            invalidityPeriod,
        );

        // Call getQuote
        const callResponse = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);

        // Assert that the returned quote matches the available liquidity
        Assert.expect(callResponse.result).toEqual(liquidityAmount);

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

    await vm.it('should add 1000 different positions and compare gas usage', async () => {
        const numberOfTicks = 1000;
        const maximumAmountIn = 10n;
        const slippage = 100; // 1%
        const invalidityPeriod = 10; // 10 blocks

        // Approve enough tokens
        await token.approve(userAddress, orderBook.address, 1000000000000000000000000000n);

        // Now, add the rest of the ticks
        for (let i = 0; i < numberOfTicks; i++) {
            const tokenOwner: Address = Blockchain.generateRandomAddress();
            const randomLiquidityAmount = BigInt((i + 1) * 2) * maximumAmountIn;

            const gas = await orderBook.addLiquidity(
                tokenAddress,
                tokenOwner.p2tr(Blockchain.network),
                randomLiquidityAmount,
                BigInt((i + 1) * tickSpacing),
                slippage,
                invalidityPeriod,
            );

            vm.log(
                `Used ${gas.usedGas}gas to add liquidity at price level ${(i + 1) * tickSpacing} - ${randomLiquidityAmount} tokens`,
            );
        }

        Blockchain.tracePointers = true;

        const startedAt = Date.now();
        // Get a quote for the specified satoshis input
        const satoshisIn = 100_000_000n; // 1 BTC.
        const callResponse = await orderBook.getQuote(tokenAddress, satoshisIn, 1000n);

        Assert.expect(callResponse.response.error).toBeUndefined();
        //Assert.expect(callResponse.result).toEqual(expectedTokensOut / precision);

        vm.info(
            `Get quote gas used: ${callResponse.response.usedGas} - Time taken: ${Date.now() - startedAt}ms`,
        );
    });
});
