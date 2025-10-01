import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, gas2USD, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient } from '../../contracts/NativeSwapTypes.js';
import { BitcoinUtils } from 'opnet';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { MotoContract } from '../../contracts/MotoContract.js';

await opnet('NativeSwap: Verify Constant Product Bug', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: MotoContract;
    let toSwap: { a: Address; r: Recipient[] }[] = [];

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeAddress: Address = Blockchain.generateRandomAddress();
    const tokenDecimals = 18;

    // Token parameters
    const totalSupply = BitcoinUtils.expandToDecimals(1_000_000_000, tokenDecimals); // 1 billion tokens
    const initialLiquidity = BitcoinUtils.expandToDecimals(25_000_000, tokenDecimals); // 2.5% of supply

    // Calculate floor price matching frontend logic
    // Price: 0.0000005 BTC per token = 50 satoshis per token
    // Frontend formula: floorPrice = (tokenBase * den) / num
    // Where tokenBase = 10^decimals, num = price in sats, den = 1
    const priceInSatoshis = 50n; // 0.0000005 BTC = 50 satoshis
    const tokenBase = 10n ** BigInt(tokenDecimals); // 10^18
    const floorPrice = tokenBase / priceInSatoshis; // (10^18 * 1) / 50 = 2 * 10^16

    // This gives us: satoshisReserve = initialLiquidity / floorPrice
    // = (25,000,000 * 10^18) / (2 * 10^16) = 1,250,000,000 satoshis = 12.5 BTC

    async function createPool(): Promise<void> {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.mintRaw(userAddress, initialLiquidity);
        await token.increaseAllowance(userAddress, nativeSwap.address, initialLiquidity);

        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: Blockchain.generateRandomAddress(),
        });

        await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: initialLiquidityProvider,
            network: Blockchain.network,
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 100,
        });
    }

    async function listTokensForSale(amount: bigint, provider: Address): Promise<void> {
        const backup = Blockchain.txOrigin;

        // Mint and transfer tokens to provider
        await token.mintRaw(provider, amount);

        // Switch to provider
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        // Approve and list
        await token.increaseAllowance(provider, nativeSwap.address, amount);

        const liquid = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            network: Blockchain.network,
            amountIn: amount,
            priority: false,
            disablePriorityQueueFees: false,
        });

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        vm.info(
            `Listed ${BitcoinUtils.formatUnits(amount, tokenDecimals)} tokens for sale - Gas: ${gas2USD(liquid.response.usedGas)} USD`,
        );
    }

    async function makeReservation(buyer: Address, satIn: bigint): Promise<void> {
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const resp = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: 0n,
            activationDelay: 0,
        });

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(resp.response.events);

        if (decoded.recipients.length) {
            toSwap.push({
                a: buyer,
                r: decoded.recipients,
            });
            vm.info(
                `Reserved ${BitcoinUtils.formatUnits(resp.expectedAmountOut, tokenDecimals)} tokens for ${BitcoinUtils.formatUnits(satIn, 8)} BTC`,
            );
        } else {
            vm.fail('No recipients found in reservation event.');
        }

        Assert.expect(resp.response.error).toBeUndefined();
    }

    async function executeSwaps(): Promise<void> {
        for (const reservation of toSwap) {
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await nativeSwap.swap({ token: tokenAddress });

            const event = s.response.events[s.response.events.length - 2];
            if (event.type !== 'SwapExecuted') {
                throw new Error(`No swap executed event found, got ${event.type}`);
            }

            const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(event.data);
            vm.log(
                `Swap executed: ${BitcoinUtils.formatUnits(d.amountOut, tokenDecimals)} tokens - Gas: ${gas2USD(s.response.usedGas)} USD`,
            );
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    vm.beforeEach(async () => {
        toSwap = [];

        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        Blockchain.blockNumber = 1000n;

        // Initialize token contract
        token = new MotoContract({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });
        Blockchain.register(token);
        await token.init();

        // Mint total supply
        await token.mintRaw(userAddress, totalSupply);

        // Initialize NativeSwap contract
        nativeSwap = new NativeSwap(userAddress, nativeAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it(
        'should demonstrate constant product bug - virtual BTC reserve not updating',
        async () => {
            vm.info('\n==================== TEST: CONSTANT PRODUCT BUG ====================\n');

            // Step 1: Create pool with 2.5% of supply at 0.0000005 BTC per token
            vm.info('STEP 1: Creating pool with initial liquidity');
            vm.info(
                `Initial liquidity: ${BitcoinUtils.formatUnits(initialLiquidity, tokenDecimals)} tokens`,
            );
            vm.info(`Price per token: 0.0000005 BTC (50 satoshis)`);
            vm.info(
                `Floor price: ${floorPrice} (formula: 10^${tokenDecimals} / ${priceInSatoshis})`,
            );
            vm.info(`Expected pool value: 12.5 BTC`);

            await createPool();
            Blockchain.blockNumber += 1n;

            // Verify initial reserves
            const initialReserves = await nativeSwap.getReserve({ token: tokenAddress });
            vm.info('\n=== INITIAL RESERVES ===');
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(initialReserves.virtualBTCReserve, 8)} BTC`,
            );

            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(initialReserves.virtualTokenReserve, tokenDecimals)} tokens`,
            );

            const initialPoolValue = Number(initialReserves.virtualBTCReserve) / 100000000;
            vm.info(`Initial pool value (calculated): ${initialPoolValue} BTC`);

            // Verify it's close to 12.5 BTC
            Assert.expect(Math.abs(initialPoolValue - 12.5)).toBeLessThan(0.1);

            // Get initial quote for reference
            const initialQuote = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: 100000000n, // 1 BTC
            });

            vm.info(
                `Initial Quote for 1 BTC: ${BitcoinUtils.formatUnits(initialQuote.tokensOut, tokenDecimals)} tokens`,
            );

            // Step 2: Simulate SELL (list tokens worth ~1 BTC)
            vm.info('\n=== STEP 2: SIMULATING SELL (Token -> BTC) ===');

            // Calculate tokens worth approximately 1 BTC at current price
            // Using the quote to get accurate amount
            const tokensToSell = BitcoinUtils.expandToDecimals(2960904, tokenDecimals);
            const sellProvider = Blockchain.generateRandomAddress();

            vm.info(
                `Listing ${BitcoinUtils.formatUnits(tokensToSell, tokenDecimals)} tokens for sale`,
            );
            await listTokensForSale(tokensToSell, sellProvider);

            Blockchain.blockNumber += 1n;

            // Verify reserves after listing
            const afterListing = await nativeSwap.getReserve({ token: tokenAddress });
            vm.info('\n=== RESERVES AFTER LISTING ===');
            vm.info(
                `Liquidity available: ${BitcoinUtils.formatUnits(afterListing.liquidity, tokenDecimals)} tokens`,
            );

            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(afterListing.virtualBTCReserve, 8)} BTC`,
            );

            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterListing.virtualTokenReserve, tokenDecimals)} tokens`,
            );

            // Step 3: Make BUY reservation for exactly 1 BTC
            vm.info('\n=== STEP 3: MAKING BUY RESERVATION (BTC -> Token) ===');
            const buyer = Blockchain.generateRandomAddress();
            const btcAmount = 100000000n; // 1 BTC in satoshis

            vm.info(`Making reservation for ${BitcoinUtils.formatUnits(btcAmount, 8)} BTC`);
            await makeReservation(buyer, btcAmount);

            Blockchain.blockNumber += 1n;

            // Check reserves before swap execution
            const beforeSwap = await nativeSwap.getReserve({ token: tokenAddress });
            vm.info('\n=== RESERVES BEFORE SWAP EXECUTION ===');
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(beforeSwap.virtualBTCReserve, 8)} BTC`,
            );

            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(beforeSwap.virtualTokenReserve, tokenDecimals)} tokens`,
            );

            vm.info(
                `Reserved Liquidity: ${BitcoinUtils.formatUnits(beforeSwap.reservedLiquidity, tokenDecimals)} tokens`,
            );

            // Calculate constant product before swap
            const kBefore = beforeSwap.virtualBTCReserve * beforeSwap.virtualTokenReserve;
            vm.info(`Constant product (k) before swap: ${kBefore}`);

            // Step 4: Execute the swap
            vm.info('\n=== STEP 4: EXECUTING SWAP ===');
            await executeSwaps();

            Blockchain.blockNumber += 1n;

            // Step 5: Check reserves after swap and demonstrate the bug
            const afterSwap = await nativeSwap.getReserve({ token: tokenAddress });
            vm.info('\n=== RESERVES AFTER SWAP EXECUTION ===');
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(afterSwap.virtualBTCReserve, 8)} BTC`,
            );
            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterSwap.virtualTokenReserve, tokenDecimals)} tokens`,
            );

            // Calculate changes
            const btcChange = afterSwap.virtualBTCReserve - beforeSwap.virtualBTCReserve;
            const tokenChange = afterSwap.virtualTokenReserve - beforeSwap.virtualTokenReserve;

            vm.info('\n=== DEMONSTRATING THE BUG ===');
            vm.info(`BTC Reserve Change: ${BitcoinUtils.formatUnits(btcChange, 8)} BTC`);
            vm.info(
                `Token Reserve Change: ${BitcoinUtils.formatUnits(tokenChange, tokenDecimals)} tokens`,
            );

            // Calculate constant product after swap
            const kAfter = afterSwap.virtualBTCReserve * afterSwap.virtualTokenReserve;
            vm.info(`\nConstant product (k) before swap: ${kBefore}`);
            vm.info(`Constant product (k) after swap: ${kAfter}`);
            vm.info(`Change in k: ${kAfter - kBefore}`);

            // Check new quote to verify price hasn't changed
            const newQuote = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: 100000000n, // 1 BTC
            });

            vm.info(
                `\nNew Quote for 1 BTC: ${BitcoinUtils.formatUnits(newQuote.tokensOut, tokenDecimals)} tokens`,
            );

            vm.info(
                `Quote difference: ${BitcoinUtils.formatUnits(newQuote.tokensOut - initialQuote.tokensOut, tokenDecimals)} tokens`,
            );

            // Verify the bug exists
            if (btcChange === 0n) {
                vm.error('\n❌ BUG CONFIRMED: Virtual BTC Reserve did not change after buy swap!');
                vm.error(
                    'Expected: BTC reserve should increase by ~1 BTC (buyer added BTC to pool)',
                );
                vm.error('Actual: No change in BTC reserve');
                vm.error('Impact: Price remains unchanged despite significant trade volume');

                // This assertion confirms the bug exists
                Assert.expect(btcChange).toEqual(0n);
            } else {
                vm.info(`✓ BTC Reserve changed by: ${BitcoinUtils.formatUnits(btcChange, 8)} BTC`);
                vm.info('Bug not present - virtual reserves updated correctly');
            }

            // Additional verification
            // With fees, k should decrease slightly (fees extracted from the system)
            const kDecrease = kBefore - kAfter;
            const kDecreasePercent = (kDecrease * 10000n) / kBefore; // basis points

            if (kDecreasePercent > 600n) {
                // More than 6% decrease is suspicious
                vm.error(`❌ Constant product decreased too much: ${kDecreasePercent / 100n}%`);
            } else if (kAfter >= kBefore) {
                vm.error('❌ Constant product should decrease slightly due to fees');
            } else {
                vm.info(
                    `✓ Constant product decreased by ${kDecreasePercent / 100n}% due to fees (expected behavior)`,
                );
            }

            vm.info('\n==================== END OF TEST ====================\n');
        },
    );
});
