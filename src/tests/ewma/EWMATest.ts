// getQuoteTests.ts

import { Address } from '@btc-vision/transaction';
import { Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';
import { gas2BTC, gas2Sat, gas2USD } from '../orderbook/utils/OrderBookUtils.js';
import { BitcoinUtils } from 'opnet';

await opnet('EWMA Contract - getQuote Method Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(5_000_000, tokenDecimals);
    const satoshisPrice: bigint = 1000n; // 100,000 satoshis
    const satoshisIn: bigint = 1_000_000_000n; // 100,000 satoshis

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
        await token.mint(userAddress, 100_000_000); // Ensure this is bigint

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress, 350_000_000_000n);
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

        const l = liquidityAmount; //* BigInt(Math.floor(Math.random() * 2) + 1);

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

    async function logPrice(): Promise<void> {
        const zeroQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `(Block ${Blockchain.blockNumber}) New price: ${zeroQuote.result.currentPrice} per sat, ${BitcoinUtils.formatUnits(zeroQuote.result.expectedAmountOut, tokenDecimals)} tokens.`,
        );
    }

    /*await vm.it('should return correct estimatedQuantity based on EWMA_V and EWMA_L', async () => {
        // Set base price p0 = 1,000 satoshis (scaled by ewma.p0ScalingFactor = 10,000)
        const p0: bigint = liquidityAmount / satoshisIn;
        await setQuote(p0);

        const initialQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `Initial Quote: ${initialQuote.result.expectedAmountOut.toString()} tokens, ${initialQuote.result.expectedAmountIn.toString()} satoshis`,
        );

        Blockchain.tracePointers = true;
        const c = await ewma.reserveTicks(
            tokenAddress,
            satoshisIn - 100n,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        vm.debugBright(
            `Reserved ${c.result} tokens for ${satoshisIn} satoshis. Cost $${gas2USD(c.response.usedGas)} USD to reserve.`,
        );

        Blockchain.tracePointers = false;
    });*/

    await vm.it('should return correct estimatedQuantity based on EWMA_V and EWMA_L', async () => {
        // Set base price p0 = 1,000 satoshis (scaled by ewma.p0ScalingFactor = 10,000)
        const p0: bigint = liquidityAmount / satoshisPrice;
        Blockchain.log(`P0 is ${p0}`);
        await setQuote(p0);

        const initialQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `Initial Quote: ${initialQuote.result.expectedAmountOut.toString()} tokens, ${initialQuote.result.expectedAmountIn.toString()} satoshis`,
        );

        await logPrice();

        // Simulate a buy operation that affects EWMA_V
        await ewma.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        // Simulate block progression to apply EWMA updates
        for (let s = 0; s < 10; s++) {
            await simulateBlocks(1n);

            await addLiquidityRandom();

            await logPrice();
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

        Blockchain.blockNumber++;

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
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );
        vm.debug(
            `Reserved ${c2.result} tokens for ${satoshisIn * 100n} satoshis. Cost $${gas2USD(c2.response.usedGas)} USD to reserve.`,
        );

        await logPrice();

        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();
        await simulateBlocks(1n);
        await logPrice();

        await simulateBlocks(10n);
        await addLiquidityRandom();

        // Fetch the quote
        await logPrice();
    });
});
