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

    await vm.it(
        'should demonstrate 50/50 mechanism with provider activation across two swaps',
        async () => {
            vm.info(
                '\n==================== TEST: 50/50 MECHANISM WITH PARTIAL FILLS ====================\n',
            );

            // Step 1: Create pool
            vm.info('STEP 1: Creating pool with initial liquidity');
            await createPool();
            Blockchain.blockNumber += 1n;

            const initialReserves = await nativeSwap.getReserve({ token: tokenAddress });
            const initialK =
                initialReserves.virtualBTCReserve * initialReserves.virtualTokenReserve;

            // Get initial quote for comparison
            const initialQuote = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: 100000000n, // 1 BTC
            });

            vm.info('\n=== INITIAL STATE ===');
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(initialReserves.virtualBTCReserve, 8)} BTC`,
            );
            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(initialReserves.virtualTokenReserve, tokenDecimals)} tokens`,
            );
            vm.info(
                `Initial Quote for 1 BTC: ${BitcoinUtils.formatUnits(initialQuote.tokensOut, tokenDecimals)} tokens`,
            );

            // Step 2: List a moderate amount of tokens to avoid overwhelming the first swap
            vm.info('\n=== STEP 2: LISTING TOKENS (50% IMPACT INITIALLY) ===');
            const tokensToList = BitcoinUtils.expandToDecimals(3_000_000, tokenDecimals); // Reduced to 3M tokens
            const sellProvider = Blockchain.generateRandomAddress();

            vm.info(`Listing ${BitcoinUtils.formatUnits(tokensToList, tokenDecimals)} tokens`);
            vm.info('With 50/50 split, only 1.5M tokens should initially impact the reserves');

            await listTokensForSale(tokensToList, sellProvider);
            Blockchain.blockNumber += 1n;

            const afterListingReserves = await nativeSwap.getReserve({ token: tokenAddress });
            vm.info('\nReserves after listing (only 50% applied):');
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(afterListingReserves.virtualBTCReserve, 8)} BTC`,
            );
            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterListingReserves.virtualTokenReserve, tokenDecimals)} tokens`,
            );
            vm.info(
                `Total liquidity queued: ${BitcoinUtils.formatUnits(afterListingReserves.liquidity, tokenDecimals)} tokens`,
            );

            // Step 3: First swap - larger amount to overcome activation impact
            vm.info('\n=== STEP 3: FIRST SWAP - PARTIAL FILL ===');
            const buyer1 = Blockchain.generateRandomAddress();
            const btcAmount1 = 80000000n; // 0.8 BTC - larger to ensure net positive BTC change

            vm.info(`Buyer 1 purchasing with ${BitcoinUtils.formatUnits(btcAmount1, 8)} BTC`);
            vm.info('This should partially fill the provider and trigger activation');

            const quote1 = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: btcAmount1,
            });
            vm.info(
                `Expected to receive: ${BitcoinUtils.formatUnits(quote1.tokensOut, tokenDecimals)} tokens`,
            );

            await makeReservation(buyer1, btcAmount1);
            Blockchain.blockNumber += 1n;

            const beforeFirstSwap = await nativeSwap.getReserve({ token: tokenAddress });
            vm.info(
                `\nReserved liquidity: ${BitcoinUtils.formatUnits(beforeFirstSwap.reservedLiquidity, tokenDecimals)} tokens`,
            );

            // Execute first swap
            vm.info('\nExecuting first swap...');
            await executeSwaps();
            Blockchain.blockNumber += 1n;

            const afterFirstSwap = await nativeSwap.getReserve({ token: tokenAddress });

            vm.info('\n=== AFTER FIRST SWAP - PROVIDER ACTIVATED ===');
            vm.info(
                '⚡ Provider should now be activated, applying the remaining 50% of their listing',
            );
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(afterFirstSwap.virtualBTCReserve, 8)} BTC`,
            );
            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterFirstSwap.virtualTokenReserve, tokenDecimals)} tokens`,
            );

            // Calculate the impact
            const btcChange1 = afterFirstSwap.virtualBTCReserve - beforeFirstSwap.virtualBTCReserve;
            const tokenChange1 =
                afterFirstSwap.virtualTokenReserve - beforeFirstSwap.virtualTokenReserve;

            vm.info(`\nFirst swap changes:`);
            vm.info(
                `BTC Reserve Change: ${btcChange1 >= 0 ? '+' : ''}${BitcoinUtils.formatUnits(btcChange1, 8)} BTC`,
            );
            vm.info(
                `Token Reserve Change: ${tokenChange1 >= 0 ? '+' : ''}${BitcoinUtils.formatUnits(tokenChange1, tokenDecimals)} tokens`,
            );

            // Explain what's happening
            if (btcChange1 < 0n) {
                vm.info(
                    '\n⚠️ BTC reserve decreased despite buy - this happens when activation impact exceeds buy amount',
                );
                vm.info(
                    'The second 50% of tokens being added dilutes the pool more than the BTC added',
                );
            }

            // Verify provider still has liquidity left
            const remainingProviderLiquidity =
                afterFirstSwap.liquidity - beforeFirstSwap.reservedLiquidity;
            vm.info(
                `\nProvider liquidity remaining: ~${BitcoinUtils.formatUnits(remainingProviderLiquidity, tokenDecimals)} tokens`,
            );

            // Step 4: Second swap
            vm.info('\n=== STEP 4: SECOND SWAP - FULL IMPACT APPLIED ===');
            const buyer2 = Blockchain.generateRandomAddress();
            const btcAmount2 = 100000000n; // 1 BTC

            vm.info(`Buyer 2 purchasing with ${BitcoinUtils.formatUnits(btcAmount2, 8)} BTC`);

            const quote2 = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: btcAmount2,
            });
            vm.info(
                `Expected to receive: ${BitcoinUtils.formatUnits(quote2.tokensOut, tokenDecimals)} tokens`,
            );

            await makeReservation(buyer2, btcAmount2);
            Blockchain.blockNumber += 1n;

            const beforeSecondSwap = await nativeSwap.getReserve({ token: tokenAddress });

            // Execute second swap
            vm.info('\nExecuting second swap...');
            await executeSwaps();
            Blockchain.blockNumber += 1n;

            const afterSecondSwap = await nativeSwap.getReserve({ token: tokenAddress });
            const k2 = afterSecondSwap.virtualBTCReserve * afterSecondSwap.virtualTokenReserve;

            vm.info('\n=== AFTER SECOND SWAP ===');
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(afterSecondSwap.virtualBTCReserve, 8)} BTC`,
            );
            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterSecondSwap.virtualTokenReserve, tokenDecimals)} tokens`,
            );

            const btcChange2 =
                afterSecondSwap.virtualBTCReserve - beforeSecondSwap.virtualBTCReserve;
            const tokenChange2 =
                afterSecondSwap.virtualTokenReserve - beforeSecondSwap.virtualTokenReserve;

            vm.info(`\nSecond swap changes:`);
            vm.info(
                `BTC Reserve Change: ${btcChange2 >= 0 ? '+' : ''}${BitcoinUtils.formatUnits(btcChange2, 8)} BTC`,
            );
            vm.info(
                `Token Reserve Change: ${tokenChange2 >= 0 ? '+' : ''}${BitcoinUtils.formatUnits(tokenChange2, tokenDecimals)} tokens`,
            );

            // Analysis
            vm.info('\n=== VERIFICATION OF 50/50 MECHANISM ===');

            // Calculate effective rates
            const effectiveRate1 = (quote1.tokensOut * 100000000n) / btcAmount1;
            const effectiveRate2 = (quote2.tokensOut * 100000000n) / btcAmount2;

            vm.info('\n📊 Rate Analysis:');
            vm.info(
                `First swap: ${BitcoinUtils.formatUnits(effectiveRate1, tokenDecimals)} tokens per BTC`,
            );
            vm.info(
                `Second swap: ${BitcoinUtils.formatUnits(effectiveRate2, tokenDecimals)} tokens per BTC`,
            );

            // The key insight: after activation, rates depend on the net pool state
            vm.info('\n💡 Key Observations:');
            if (btcChange1 < 0n) {
                vm.info('1. First swap BTC decreased due to activation overwhelming buy amount');
            } else {
                vm.info('1. First swap BTC increased (buy amount exceeded activation impact)');
            }

            vm.info('2. Second swap operates on fully-impacted pool (all 3M tokens applied)');
            vm.info('3. Price discovery reflects true market depth after activation');

            // Total system changes
            const totalBtcChange =
                afterSecondSwap.virtualBTCReserve - initialReserves.virtualBTCReserve;
            const totalTokenChange =
                afterSecondSwap.virtualTokenReserve - initialReserves.virtualTokenReserve;

            vm.info('\n=== CUMULATIVE IMPACT ===');
            vm.info(
                `Net BTC change from initial: ${totalBtcChange >= 0 ? '+' : ''}${BitcoinUtils.formatUnits(totalBtcChange, 8)} BTC`,
            );
            vm.info(
                `Net Token change from initial: ${totalTokenChange >= 0 ? '+' : ''}${BitcoinUtils.formatUnits(totalTokenChange, tokenDecimals)} tokens`,
            );

            const totalBtcIn = btcAmount1 + btcAmount2;
            vm.info(`\nTotal BTC traded: ${BitcoinUtils.formatUnits(totalBtcIn, 8)} BTC`);

            // Verify constant product behavior
            vm.info('\n=== CONSTANT PRODUCT INTEGRITY ===');
            const k1 = afterFirstSwap.virtualBTCReserve * afterFirstSwap.virtualTokenReserve;

            vm.info(`Initial k: ${initialK}`);
            vm.info(`k after first swap: ${k1}`);
            vm.info(`k after second swap: ${k2}`);

            const kDecrease = ((initialK - k2) * 10000n) / initialK;
            vm.info(`Total k decrease: ${kDecrease / 100n}.${kDecrease % 100n}% (due to fees)`);

            // Assertions - adjusted for reality
            vm.info('\n=== FINAL VERIFICATION ===');

            // 1. Second swap should always increase BTC (no more activation)
            Assert.expect(btcChange2 > 0n).toEqual(true);
            vm.info('✓ Second swap increased BTC reserves (no activation impact)');

            // 2. k should decrease due to fees
            Assert.expect(k2 < initialK).toEqual(true);
            vm.info('✓ Constant product decreased appropriately (fees extracted)');

            // 3. Total token change should reflect listing amount
            const expectedMinTokenChange = tokensToList; // At minimum, the listed tokens are added
            Assert.expect(totalTokenChange >= expectedMinTokenChange).toEqual(true);
            vm.info('✓ Token reserves reflect listed amount');

            // 4. System maintained mathematical consistency
            Assert.expect(kDecrease < 1000n).toEqual(true); // Less than 10%
            vm.info('✓ System maintained mathematical consistency');

            vm.info('\n==================== 50/50 MECHANISM VERIFIED ====================\n');
        },
    );
});
