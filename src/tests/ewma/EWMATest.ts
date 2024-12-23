import { Address } from '@btc-vision/transaction';
import { Blockchain, CallResponse, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { EWMA, Recipient } from '../../contracts/ewma/EWMA.js';
import {
    createRecipientsOutput,
    gas2BTC,
    gas2Sat,
    gas2USD,
} from '../orderbook/utils/OrderBookUtils.js';
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
    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    let data: { x: number; y: number[] }[] = [];

    vm.beforeEach(async () => {
        Blockchain.blockNumber = 2500n;

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

        data = [];
        toSwap = [];

        // Add initial liquidity
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

        const quote = await ewma.createPool(tokenAddress, p0);

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

    let open: number = 0;

    async function logPrice(): Promise<void> {
        const zeroQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `(Block ${Blockchain.blockNumber}) New price: ${BitcoinUtils.formatUnits(zeroQuote.result.currentPrice, tokenDecimals)} token per sat, ${BitcoinUtils.formatUnits(zeroQuote.result.expectedAmountOut, tokenDecimals)} tokens, sat spent: ${zeroQuote.result.expectedAmountIn}`,
        );

        const close = parseFloat(
            BitcoinUtils.formatUnits(zeroQuote.result.currentPrice, tokenDecimals),
        );
        if (!open) open = 0.25;

        data.push({
            x: Number(Blockchain.blockNumber.toString()),
            y: [-open, -close, -close, -close],
            //inverted: false,
        });

        open = close;
    }

    let toSwap: { a: Address; r: Recipient[] }[] = [];

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
            vm.fail('No recipients');
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        return r;
    }

    async function swapAll(): Promise<void> {
        for (let i = 0; i < toSwap.length; i++) {
            const reservation = toSwap[i];
            const provider = reservation.a;
            const r = reservation.r;

            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;

            vm.log(
                `Swapping for ${provider.toString()}, ${r.length} recipients, ${r[0].amount.toString()} tokens`,
            );

            createRecipientsOutput(r);

            const s = await ewma.swap(tokenAddress, false);
            const decoded = EWMA.decodeSwapExecutedEvent(
                s.response.events[s.response.events.length - 1].data,
            );
            console.log(decoded);
            vm.log(`Swapped`);
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        toSwap = [];
    }

    /**
     * New Unit Test: Simulate Real-World Trading Dynamics Through Random Interactions
     */
    await vm.it('should simulate market dynamics through random interactions', async () => {
        // Step 1: Add a substantial initial liquidity to stabilize the pool
        await addLiquidityRandom(liquidityAmount * 10n);
        vm.debug('Initial liquidity added.');

        // Step 2: Simulate trading over multiple iterations
        for (let x = 1; x < 3; x++) {
            // Simulate two major phases
            vm.debug(`\n--- Starting Phase ${x} ---`);

            for (let i = 0; i < 32; i++) {
                // 32 iterations per phase
                vm.debug(`\n--- Phase ${x}, Iteration ${i + 1} ---`);

                // Randomly add liquidity multiple times within this iteration
                const addLiquidityRounds = Math.floor(Math.random() * 10) + x;
                for (let y = 0; y < addLiquidityRounds; y++) {
                    const liquidityRounds = Math.floor(Math.random() * 5);
                    for (let yy = 0; yy < liquidityRounds; yy++) {
                        const multiplier = BigInt(Math.ceil(yy + 1 + Math.random()) * x);
                        const liquidityToAdd = liquidityAmount * multiplier;
                        await addLiquidityRandom(liquidityToAdd);
                        vm.debug(`Added liquidity: ${liquidityToAdd} tokens.`);
                    }
                }

                // Execute all pending swaps
                await swapAll();
                vm.debug('Executed all pending swaps.');

                // Randomly adjust reserves to simulate market volatility
                const reserveAdjustRounds = Math.floor(Math.random() * 10);
                for (let y = 0; y < reserveAdjustRounds; y++) {
                    const reserveAdjustments = Math.floor(Math.random() * 5);
                    for (let yy = 0; yy < reserveAdjustments; yy++) {
                        const reserveChange =
                            120_000n * BigInt(Math.ceil(yy + 1 + Math.random() * 2 * x));
                        await randomReserve(reserveChange);
                        vm.debug(`Adjusted reserve by: ${reserveChange} tokens.`);
                    }
                }

                // Simulate the passage of one block and log the current price
                await simulateBlocks(1n);
                await logPrice();
            }

            // After completing 32 iterations in this phase, perform a final swap and log
            await swapAll();
            vm.debug(`Phase ${x} final swaps executed.`);
            await simulateBlocks(1n);
            await logPrice();
        }

        // Final price logging after all interactions
        await logPrice();
        vm.debug('Final price logged.');

        // Log the collected data for further analysis if needed
        console.log(JSON.stringify(data));
    });
});
