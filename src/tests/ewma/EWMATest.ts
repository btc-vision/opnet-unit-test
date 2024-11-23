// getQuoteTests.ts

import { Address } from '@btc-vision/transaction';
import { Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';
import { gas2BTC, gas2Sat, gas2USD } from '../orderbook/utils/OrderBookUtils.js';

await opnet('EWMA Contract - getQuote Method Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const satoshisIn: bigint = 100_000n; // 100,000 satoshis

    const providerCount: bigint = 10n;
    const fee: bigint = EWMA.reservationFeePerProvider * providerCount;

    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    const minimumLiquidityPerTick: bigint = 10n;
    const slippage: number = 100; // 1%

    const DECIMALS: bigint = 10_000n; // Define the scaling factor

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
        await token.mint(userAddress, 10_000_000); // Ensure this is bigint

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress);
        Blockchain.register(ewma);
        await ewma.init();

        // Add liquidity
        await addLiquidityRandom();
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    /**
     * Helper function to add liquidity from a random provider.
     */
    async function addLiquidityRandom(): Promise<void> {
        const provider = Blockchain.generateRandomAddress();

        const l = liquidityAmount * BigInt(Math.floor(Math.random() * 10) + 1);

        // Transfer tokens to the provider
        await token.transfer(userAddress, provider, l);

        // Provider approves the EWMA contract to spend tokens
        await token.approve(provider, ewma.address, l);

        // Provider adds liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;
        await ewma.addLiquidity(
            tokenAddress,
            provider.p2tr(Blockchain.network),
            l, // Assuming maximumAmountIn is liquidityAmount
        );
    }

    /**
     * Helper function to set the base price (p0) in the EWMA contract.
     * @param p0 - Base price in satoshis, scaled by ewma.p0ScalingFactor.
     */
    async function setQuote(p0: bigint): Promise<void> {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        const quote = await ewma.setQuote(tokenAddress, p0);

        vm.debug(
            `Quote set! Gas cost: ${gas2Sat(quote.usedGas)} sat (${gas2BTC(quote.usedGas)} BTC, $${gas2USD(quote.usedGas)})`,
        );
    }

    /**
     * Helper function to simulate block progression and update EWMA_L and EWMA_V.
     * @param blocks - Number of blocks to advance.
     */
    async function simulateBlocks(blocks: bigint): Promise<void> {
        for (let i = 0n; i < blocks; i++) {
            Blockchain.blockNumber += 1n;
            // Optionally, perform actions that would trigger EWMA updates
        }

        await Promise.resolve();
    }

    /**
     * Test Case 1: Verify that getQuote returns the correct estimatedQuantity based on EWMA_V and EWMA_L.
     */
    await vm.it('should return correct estimatedQuantity based on EWMA_V and EWMA_L', async () => {
        // Set base price p0 = 1,000 satoshis (scaled by ewma.p0ScalingFactor = 10,000)
        const p0: bigint = liquidityAmount / satoshisIn;
        await setQuote(p0);

        const initialQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `Initial Quote: ${initialQuote.result.expectedAmountOut.toString()} tokens, ${initialQuote.result.expectedAmountIn.toString()} satoshis`,
        );

        // Simulate a buy operation that affects EWMA_V
        await ewma.reserveTicks(
            tokenAddress,
            satoshisIn - 100n,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        // Simulate block progression to apply EWMA updates
        for (let s = 0; s < 10; s++) {
            await simulateBlocks(1n);

            await addLiquidityRandom();

            const quoteResponse2 = await ewma.getQuote(tokenAddress, satoshisIn);
            vm.debug(
                `Quote after block ${s + 1}: ${quoteResponse2.result.expectedAmountOut.toString()} tokens (scaled), ${quoteResponse2.result.expectedAmountIn.toString()} satoshis`,
            );
        }

        await simulateBlocks(10n);
        vm.debugBright(`Simulating 10 blocks and reserving liquidity`);

        const c = await ewma.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        // new quote
        const quote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debugBright(
            `Reserved ${c.result} tokens for ${satoshisIn} satoshis. New quote is ${quote.result.expectedAmountOut} tokens for ${quote.result.expectedAmountIn} satoshis`,
        );

        await simulateBlocks(100n);
        vm.debugBright(`Simulating 100 blocks and reserving liquidity`);

        const quoteBefore = await ewma.getQuote(tokenAddress, satoshisIn);
        for (let s = 0; s < 150; s++) {
            await addLiquidityRandom();
        }

        vm.debugBright(`Added 150 providers.`);

        const quoteResponse2 = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `Quote before sell pressure simulation: ${quoteBefore.result.expectedAmountOut.toString()} tokens (scaled), ${quoteBefore.result.expectedAmountIn.toString()} satoshis`,
        );
        vm.debug(
            `Quote after sell pressure simulation: ${quoteResponse2.result.expectedAmountOut.toString()} tokens (scaled), ${quoteResponse2.result.expectedAmountIn.toString()} satoshis`,
        );

        //Blockchain.tracePointers = true;
        const c2 = await ewma.reserveTicks(
            tokenAddress,
            satoshisIn * 100n,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        vm.debugBright(
            `Skipping 100 blocks. Loaded ${ewma.loadedPointers}, stored: ${ewma.storedPointers}`,
        );

        //Blockchain.tracePointers = false;

        const quoteBefore1 = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.success(
            `(before 100 blocks) New quote is ${quoteBefore1.result.expectedAmountOut} tokens for ${quoteBefore1.result.expectedAmountIn} satoshis. Reserved: ${c2.result} Cost $${gas2USD(c2.response.usedGas)} USD to reserve.`,
        );

        await addLiquidityRandom();
        const a = await ewma.reserveTicks(
            tokenAddress,
            satoshisIn / 3n,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        console.log(a.result);

        await simulateBlocks(1n);
        await ewma.reserveTicks(
            tokenAddress,
            satoshisIn / 3n,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );
        //await addLiquidityRandom();

        const quote2 = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.success(
            `(after 100 blocks) New quote is ${quote2.result.expectedAmountOut} tokens for ${quote2.result.expectedAmountIn} satoshis. Reserved: ${c2.result} Cost $${gas2USD(c2.response.usedGas)} USD to reserve.`,
        );

        const c22 = await ewma.reserveTicks(
            tokenAddress,
            satoshisIn / 3n,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        vm.debug(
            `(after 100 blocks) Reserved ${c22.result} tokens for ${satoshisIn} satoshis. Cost $${gas2USD(c22.response.usedGas)} USD to reserve.`,
        );

        //await simulateBlocks(100n);
        await addLiquidityRandom();

        // Fetch the quote
        const quoteResponse = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `(after 100 blocks) Added liquidity, new quote: ${quoteResponse.result.expectedAmountOut.toString()} tokens, ${quoteResponse.result.expectedAmountIn.toString()} satoshis`,
        );
    });
});
