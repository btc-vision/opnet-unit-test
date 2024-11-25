// realWorldScenariosTests.ts

import { Address } from '@btc-vision/transaction';
import { Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';
import { gas2BTC, gas2Sat, gas2USD } from '../orderbook/utils/OrderBookUtils.js';
import { BitcoinUtils } from 'opnet';

await opnet('EWMA Contract - Real World Scenario Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const pLiquidityAmount: bigint = Blockchain.expandToDecimal(1_001_231, tokenDecimals);

    const satoshisIn: bigint = 1_000_000n; // 1 BTC
    const expectedTokenPerSat: bigint = Blockchain.expandToDecimal(2, tokenDecimals) / 10n; // 10 tokens per sat.

    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    const slippage: number = 100;

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
        await token.mint(userAddress, 100_000_000);

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress, 350_000_000_000n);
        Blockchain.register(ewma);
        await ewma.init();
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    /**
     * Helper function to add liquidity from a provider.
     */
    async function addLiquidity(provider: Address, amount: bigint): Promise<void> {
        // Transfer tokens to the provider
        await token.transfer(userAddress, provider, amount);

        // Provider approves the EWMA contract to spend tokens
        await token.approve(provider, ewma.address, amount);

        // Provider adds liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;
        await ewma.addLiquidity(tokenAddress, provider.p2tr(Blockchain.network), amount);
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

    async function logPrice(a: bigint = satoshisIn, reserved: string = ''): Promise<void> {
        const zeroQuote = await ewma.getQuote(tokenAddress, a);
        vm.debug(
            `(Block ${Blockchain.blockNumber}) New price: ${BitcoinUtils.formatUnits(zeroQuote.result.currentPrice, tokenDecimals)} token per sat, ${BitcoinUtils.formatUnits(zeroQuote.result.expectedAmountIn * zeroQuote.result.currentPrice, tokenDecimals)} tokens, sat spent: ${zeroQuote.result.expectedAmountIn}, Reserved: ${reserved}`,
        );
    }

    // Now, define test cases for different real-world scenarios.

    await vm.it('Token launch with high demand - multiple buyers swapping tokens', async () => {
        // Set base price p0
        const p0: bigint = expectedTokenPerSat;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        const provider = Blockchain.generateRandomAddress();
        await addLiquidity(provider, pLiquidityAmount);

        //await simulateBlocks(100n);

        //let r = await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut, slippage);
        //await logPrice(BitcoinUtils.formatUnits(r.result, tokenDecimals));

        //r = await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut, slippage);
        //vm.log(BitcoinUtils.formatUnits(r.result, tokenDecimals));
        //await logPrice(BitcoinUtils.formatUnits(r.result, tokenDecimals));

        let l2: bigint = 0n;

        // Simulate multiple buyers swapping tokens
        for (let i = 0; i < 30; i++) {
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = buyer;
            Blockchain.msgSender = buyer;

            const satoshisToSpend = satoshisIn / BigInt(30 - i + 1);
            const nSatoshisToSpend = satoshisIn / BigInt(29 - i + 1);
            const r = await ewma.reserveTicks(
                tokenAddress,
                satoshisToSpend,
                pLiquidityAmount,
                slippage,
            );
            await logPrice(nSatoshisToSpend, BitcoinUtils.formatUnits(r.result, tokenDecimals));
            await simulateBlocks(1n); // Advance one block

            l2 += r.result;
        }

        for (let i = 0; i < 30; i++) {
            const provider2 = Blockchain.generateRandomAddress();
            await addLiquidity(provider2, l2 / 30n);
            await logPrice();

            await simulateBlocks(1n); // Advance one block
        }

        await addLiquidity(provider, 10_000n);

        //for (let i = 0; i < 95; i++) {
        //    await logPrice();
        //    await simulateBlocks(1n); // Advance one block
        //}
    });

    /*await vm.it('Whale purchase - single large buy order', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        for (let i = 0; i < 10; i++) {
            const provider = Blockchain.generateRandomAddress();
            await addLiquidity(provider, liquidityAmount * 2n);
        }

        // Simulate a whale making a large purchase
        const whale = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = whale;
        Blockchain.msgSender = whale;

        const whaleSatoshisIn = satoshisIn * 100n; // Whale spends a large amount
        await ewma.reserveTicks(tokenAddress, whaleSatoshisIn, minimumAmountOut, slippage);

        await logPrice();
        await simulateBlocks(1n);
    });

    await vm.it('Dumping - multiple sellers removing liquidity', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        const providers: Address[] = [];
        for (let i = 0; i < 10; i++) {
            const provider = Blockchain.generateRandomAddress();
            providers.push(provider);
            await addLiquidity(provider, liquidityAmount * 2n);
        }

        await logPrice();

        // Simulate multiple providers removing liquidity
        for (const provider of providers) {
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
            await ewma.removeLiquidity(tokenAddress);

            await logPrice();
            await simulateBlocks(1n);
        }
    });

    await vm.it('Dead activity - no trades for extended period', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        for (let i = 0; i < 5; i++) {
            const provider = Blockchain.generateRandomAddress();
            await addLiquidity(provider, liquidityAmount);
        }

        await logPrice();

        // Simulate extended period with no activity
        await simulateBlocks(100n);

        await logPrice();
    });

    await vm.it('Market recovery after dump - new liquidity added', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        const providers: Address[] = [];
        for (let i = 0; i < 5; i++) {
            const provider = Blockchain.generateRandomAddress();
            providers.push(provider);
            await addLiquidity(provider, liquidityAmount);
        }

        await logPrice();

        // Simulate a dump - providers remove liquidity
        for (const provider of providers) {
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
            await ewma.removeLiquidity(tokenAddress);
            await simulateBlocks(1n);
        }

        await logPrice();

        // Simulate market recovery - new providers add liquidity
        for (let i = 0; i < 5; i++) {
            const provider = Blockchain.generateRandomAddress();
            await addLiquidity(provider, liquidityAmount);
            await simulateBlocks(1n);
        }

        await logPrice();
    });

    await vm.it('Whale dump - large sell order affecting price significantly', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        for (let i = 0; i < 10; i++) {
            const provider = Blockchain.generateRandomAddress();
            await addLiquidity(provider, liquidityAmount * 5n);
        }

        await logPrice();

        // Simulate a whale removing a large amount of liquidity
        const whaleProvider = Blockchain.generateRandomAddress();
        await addLiquidity(whaleProvider, liquidityAmount * 50n);

        await logPrice();

        // Whale removes liquidity
        Blockchain.txOrigin = whaleProvider;
        Blockchain.msgSender = whaleProvider;
        await ewma.removeLiquidity(tokenAddress);

        await logPrice();
    });

    await vm.it('High-frequency trading - rapid small trades', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity from multiple providers
        for (let i = 0; i < 10; i++) {
            const provider = Blockchain.generateRandomAddress();
            await addLiquidity(provider, liquidityAmount);
        }

        await logPrice();

        // Simulate high-frequency trading
        for (let i = 0; i < 50; i++) {
            const trader = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = trader;
            Blockchain.msgSender = trader;

            const satoshisToSpend = satoshisIn / 100n; // Small amounts
            await ewma.reserveTicks(tokenAddress, satoshisToSpend, minimumAmountOut, slippage);

            await simulateBlocks(0n); // Immediate block advancement (could be 0)
            await logPrice();
        }

        await simulateBlocks(1n);
        await logPrice();
    });

    await vm.it('No activity followed by sudden surge in trades', async () => {
        // Set base price p0
        const p0: bigint = pLiquidityAmount / satoshisPrice;
        await setQuote(p0);

        // Add initial liquidity
        const provider = Blockchain.generateRandomAddress();
        await addLiquidity(provider, liquidityAmount);

        await logPrice();

        // Simulate no activity
        await simulateBlocks(100n);
        await logPrice();

        // Sudden surge in trades
        for (let i = 0; i < 20; i++) {
            const trader = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = trader;
            Blockchain.msgSender = trader;

            const satoshisToSpend = satoshisIn * 2n;
            await ewma.reserveTicks(tokenAddress, satoshisToSpend, minimumAmountOut, slippage);

            await simulateBlocks(1n);
            await logPrice();
        }
    });*/
});
