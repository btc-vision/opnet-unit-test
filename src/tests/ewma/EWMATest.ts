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

    const liquidityAmount: bigint = Blockchain.expandToDecimal(5_000, tokenDecimals);
    const pLiquidityAmount: bigint = Blockchain.expandToDecimal(100_000, tokenDecimals);
    const satoshisPrice: bigint = 400_000n; // 0.001 BTC

    const satoshisIn: bigint = 1_000_000n; // 0.001 BTC

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

        // Set base price p0 = 1,000 satoshis (scaled by ewma.p0ScalingFactor = 10,000)
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        Blockchain.log(`P0 is ${p0}`);
        await setQuote(p0);

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
    async function addLiquidityRandom(l: bigint = liquidityAmount): Promise<void> {
        const provider = Blockchain.generateRandomAddress();

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
            `(Block ${Blockchain.blockNumber}) New price: ${BitcoinUtils.formatUnits(zeroQuote.result.currentPrice, tokenDecimals)} token per sat, ${BitcoinUtils.formatUnits(zeroQuote.result.expectedAmountOut, tokenDecimals)} tokens, sat spent: ${zeroQuote.result.expectedAmountIn}`,
        );
    }

    await vm.it('should be able to quote and reserve and affect the price', async () => {
        const initialQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `Initial Price: ${initialQuote.result.currentPrice}, Quote: ${initialQuote.result.expectedAmountOut.toString()} tokens, ${initialQuote.result.expectedAmountIn.toString()} satoshis`,
        );

        await logPrice();

        // Simulate a buy operation that affects EWMA_V
        await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut, slippage);

        // Simulate block progression to apply EWMA updates
        for (let s = 0; s < 10; s++) {
            await simulateBlocks(1n);

            await addLiquidityRandom();

            await logPrice();
        }

        await simulateBlocks(10n);
        vm.debugBright(`Simulating 10 blocks and reserving liquidity`);

        const c = await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut, slippage);

        // new quote
        const quote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debugBright(
            `Reserved ${c.result} tokens for ${satoshisIn} satoshis. New quote is ${quote.result.expectedAmountOut} tokens for ${quote.result.expectedAmountIn} satoshis`,
        );

        await simulateBlocks(100n);
        vm.debugBright(`Simulating 100 blocks and reserving liquidity`);

        const quoteBefore = await ewma.getQuote(tokenAddress, satoshisIn);
        for (let s = 0; s < 150; s++) {
            await addLiquidityRandom(liquidityAmount / 2n);
        }

        await addLiquidityRandom(liquidityAmount * 30n);
        vm.debugBright(`Added 150 providers.`);

        Blockchain.blockNumber++;

        vm.debug(
            `Quote before sell pressure simulation ${quoteBefore.result.currentPrice} uToken per sat: ${quoteBefore.result.expectedAmountOut.toString()} tokens (scaled), ${quoteBefore.result.expectedAmountIn.toString()} satoshis`,
        );

        console.log('whale purchase');

        await logPrice();

        //Blockchain.tracePointers = true;
        const c2 = await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut, slippage);
        vm.debug(
            `Reserved ${BitcoinUtils.formatUnits(c2.result, tokenDecimals)} tokens for ${satoshisIn} satoshis. Cost $${gas2USD(c2.response.usedGas)} USD to reserve.`,
        );

        await logPrice();

        console.log('after whale purchase');

        // log blocks with no updates
        await simulateBlocks(1n);
        await logPrice();
        for (let s = 0; s < 50; s++) {
            await addLiquidityRandom(liquidityAmount / 2n);
        }
        await logPrice();
        console.log('before block change');
        await simulateBlocks(1n);
        await logPrice();
        console.log('after block change');
        //await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut, slippage);
        //await logPrice();

        /*console.log('before purchase');
        await simulateBlocks(1n);
        await logPrice();
        console.log('after purchase');*/

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
