import { Address } from '@btc-vision/transaction';
import { Blockchain, CallResponse, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap, Recipient } from '../../contracts/ewma/NativeSwap.js';
import { createRecipientsOutput, gas2USD } from '../../tests/utils/TransactionUtils.js';
import { BitcoinUtils } from 'opnet';

await opnet('EWMA Contract - Big Listing and Big Pump Scenario', async (vm: OPNetUnit) => {
    let ewma: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();
    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    // For demonstration, define total minted supply of tokens (we never exceed this).
    const totalMintedSupply: bigint = Blockchain.expandToDecimal(1_000_000_000_000, tokenDecimals);

    // Some baseline liquidity and price parameters
    const liquidityAmount: bigint = Blockchain.expandToDecimal(50_000, tokenDecimals);
    const pLiquidityAmount: bigint = Blockchain.expandToDecimal(300_000, tokenDecimals);
    const satoshisPrice: bigint = 400_000n; // 0.004 BTC if 400k sats
    const satoshisIn: bigint = 1_000_000n; // 0.01 BTC if 1,000,000 sats
    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // min 10 tokens

    // p0 = pLiquidityAmount / satoshisPrice (or just a placeholder big number for demonstration)
    const p0: bigint = BitcoinUtils.expandToDecimals(1, 18);

    // Tracking how many tokens have been deposited as liquidity so far
    let totalLiquidityUsed: bigint = 0n;

    // This will store price data for logging
    let data: { x: number; y: number[] }[] = [];

    vm.beforeEach(async () => {
        Blockchain.blockNumber = 2500n;

        // Reset & init
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

        // Mint a fixed total supply to userAddress
        await token.mintRaw(userAddress, totalMintedSupply);

        // Instantiate and register the EWMA contract
        ewma = new NativeSwap(userAddress, ewmaAddress, 500_000_000_000n);
        Blockchain.register(ewma);
        await ewma.init();

        // Create the pool with some initial liquidity
        await createPool(p0, p0 * 1_000_000_000n); // large “initial liquidity” just for demonstration

        data = [];
        toSwap = [];

        // Optionally add some baseline liquidity:
        // await addLiquidityRandom(liquidityAmount);
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    /**
     * Helper to add liquidity from a random provider, ensuring we do NOT exceed totalMintedSupply.
     */
    async function addLiquidityRandom(l: bigint = liquidityAmount): Promise<void> {
        // Check if we can add l tokens without exceeding totalMintedSupply
        if (totalLiquidityUsed + l > totalMintedSupply) {
            vm.fail(`Cannot add ${l} tokens as liquidity; it would exceed 100% minted supply.`);
        }

        const provider = Blockchain.generateRandomAddress();

        // Transfer tokens from userAddress to provider
        await token.transfer(userAddress, provider, l);

        // Approve EWMA contract to spend tokens
        await token.approve(provider, ewma.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;
        await ewma.listLiquidity(tokenAddress, provider.p2tr(Blockchain.network), l);

        // Update total liquidity used
        totalLiquidityUsed += l;
    }

    /**
     * Helper to create the pool.
     */
    async function createPool(
        floorPrice: bigint,
        initialLiquidity: bigint,
        antiBotEnabledFor: number = 0,
        antiBotMaximumTokensPerReservation: bigint = 0n,
    ): Promise<void> {
        if (initialLiquidity > totalMintedSupply) {
            vm.fail(
                `Cannot create pool with initial liquidity ${initialLiquidity}, exceeds minted supply.`,
            );
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Transfer enough tokens for the pool creation
        await token.mintRaw(userAddress, initialLiquidity);
        await token.approve(userAddress, ewma.address, initialLiquidity);

        await ewma.createPool(
            tokenAddress,
            floorPrice,
            initialLiquidity,
            initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
        );

        totalLiquidityUsed += initialLiquidity;
    }

    /**
     * Helper to simulate block progression with random increments (e.g., 1 to 3 blocks).
     */
    async function simulateBlocksRandom(): Promise<void> {
        //const randomBlockCount = BigInt(Math.floor(Math.random() * 3) + 1);
        //for (let i = 0n; i < randomBlockCount; i++) {
        Blockchain.blockNumber += 1n;
        //}
        await Promise.resolve();

        await logPrice();
    }

    let open: number = 0;

    /**
     * Logs the current price (quote) and pushes data points into `data`.
     */
    async function logPrice(): Promise<void> {
        const zeroQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `(Block ${Blockchain.blockNumber}) Price: ${BitcoinUtils.formatUnits(
                zeroQuote.result.currentPrice,
                tokenDecimals,
            )} tokens per sat | 
             Out: ${BitcoinUtils.formatUnits(
                 zeroQuote.result.expectedAmountOut,
                 tokenDecimals,
             )} tokens | 
             Sats spent: ${zeroQuote.result.expectedAmountIn}`,
        );

        const close = parseFloat(
            BitcoinUtils.formatUnits(zeroQuote.result.currentPrice, tokenDecimals),
        );

        if (Blockchain.blockNumber === 2500n) return;

        if (open) {
            data.push({
                x: Number(Blockchain.blockNumber.toString()),
                // Just a sample candle
                y: [-open, -open, -close, -close],
            });
        } else {
            console.log(open);
        }

        open = close;
    }

    let toSwap: { a: Address; r: Recipient[] }[] = [];

    /**
     * Reserves tokens by sending satoshis in. This simulates a user wanting to purchase.
     */
    async function randomReserve(
        amount: bigint,
    ): Promise<{ result: bigint; response: CallResponse }> {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const r = await ewma.reserve(tokenAddress, amount, minimumAmountOut);
        const decoded = ewma.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            toSwap.push({
                a: provider,
                r: decoded.recipients,
            });
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

        // Reset
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        return r;
    }

    /**
     * Executes the swap for all reservations.
     */
    async function swapAll(): Promise<void> {
        for (let i = 0; i < toSwap.length; i++) {
            const reservation = toSwap[i];
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await ewma.swap(tokenAddress, false);
            vm.log(`Swapped spent ${gas2USD(s.response.usedGas)} USD in gas`);
        }
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    /**
     * Test: Simulate a Big Listing + Big Pump, with extra randomization.
     */
    await vm.it(
        'should simulate a big listing and big pump scenario (super randomized)',
        async () => {
            // STEP 2: Simulate "pre-listing" FOMO
            /*const preListingIterations = Math.floor(Math.random() * 50) + 20; // e.g. 20 to 70
            vm.debug(`Simulating ${preListingIterations} smaller random reserves...`);
            for (let i = 0; i < preListingIterations; i++) {
                const randomAmount = BigInt(Math.floor(Math.random() * 200000) + 50000);
                try {
                    await randomReserve(randomAmount);
                    vm.debug(`Completed a small random purchase of ~${randomAmount} satoshis.`);
                } catch (e) {
                    vm.debug(`Pre-listing random purchase error: ${String(e)}`);
                }
            }
            await simulateBlocksRandom();
            await swapAll();
            await simulateBlocksRandom();

            // STEP 3: Big Listing Day - Large Trading Volume
            vm.debug('\n****** Big Listing Event ******\n');
            const listingRounds = Math.floor(Math.random() * 15) + 15; // e.g. 15 to 30
            for (let i = 0; i < listingRounds; i++) {
                // More liquidity from new providers
                const extraLiquidity =
                    liquidityAmount * BigInt(i + 1) * BigInt(Math.floor(Math.random() * 5) + 1);
                try {
                    await addLiquidityRandom(extraLiquidity);
                    vm.debug(`Extra liquidity (round ${i + 1}): ${extraLiquidity} tokens.`);
                } catch (e) {
                    vm.debug(`Liquidity add failed: ${String(e)}`);
                }

                // Random trades
                const tradesCount = Math.floor(Math.random() * 5) + 1; // 1-5 trades
                for (let j = 0; j < tradesCount; j++) {
                    const randomAmount = BigInt(Math.floor(Math.random() * 500000) + 100000);
                    try {
                        await randomReserve(randomAmount);
                    } catch (e) {
                        vm.debug(`Listing random buy error: ${String(e)}`);
                    }
                }
            }
            await simulateBlocksRandom();
            await swapAll();
            await simulateBlocksRandom();

            // STEP 4: The BIG BUY - Whale Purchase
            vm.debug('\n****** Whale comes in with a massive purchase ******\n');
            const bigBuyAmount = BigInt(Math.floor(Math.random() * 500000000) + 500000000); // 0.5B to ~1B sats
            vm.debug(`Whale is buying with ${bigBuyAmount} satoshis...`);
            await randomReserve(bigBuyAmount);
            await simulateBlocksRandom();
            await swapAll();
            await simulateBlocksRandom();

            // STEP 5: Post-listing Price Pump
            vm.debug('\n****** Price Pump After Whale Buy ******\n');
            const postPumpTrades = Math.floor(Math.random() * 10) + 3; // 3 to 12
            for (let i = 0; i < postPumpTrades; i++) {
                const randomAmount = BigInt(Math.floor(Math.random() * 500000) + 100000);
                try {
                    await randomReserve(randomAmount);
                } catch (e) {
                    vm.debug(`Price pump random buy error: ${String(e)}`);
                }
            }
            await simulateBlocksRandom();
            await swapAll();
            await simulateBlocksRandom();*/

            // STEP 6: Extended Scenario
            vm.debug('\n****** Extended Random-Block Scenario ******\n');
            const extendedBlocks = Math.floor(Math.random() * 30) + 30; // 30 to 60
            for (let b = 1; b <= extendedBlocks; b++) {
                await swapAll();

                // Add random liquidity in each block (1 to 3 tries)
                const addAttempts = Math.floor(Math.random() * 10) + 1;
                for (let t = 0; t < addAttempts; t++) {
                    const addLiq = pLiquidityAmount * BigInt(Math.floor(Math.random() * 70) + 1);
                    try {
                        await addLiquidityRandom(addLiq);
                        vm.debug(`Added random liquidity: ${addLiq} tokens`);
                    } catch (e) {
                        vm.debug(`Failed random liquidity add: ${String(e)}`);
                    }
                }

                // Make a few random purchases
                const purchaseAttempts = Math.floor(Math.random() * 5) + 1;
                for (let t = 0; t < purchaseAttempts; t++) {
                    const randomAmount = BigInt(Math.floor(Math.random() * 1000000000) + 100000000);
                    try {
                        await randomReserve(randomAmount);
                        vm.debug(`Block #${b}: reserved ~${randomAmount} satoshis worth of tokens`);
                    } catch (e) {
                        vm.debug(`Block #${b}, trade #${t} error: ${String(e)}`);
                    }
                }

                // Simulate blocks, then swap
                await simulateBlocksRandom();
            }

            vm.debug('\nScenario completed. Price data:');
            console.log(JSON.stringify(data));
        },
    );
});
