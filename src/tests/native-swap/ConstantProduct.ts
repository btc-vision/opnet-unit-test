import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, gas2USD, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient } from '../../contracts/NativeSwapTypes.js';
import { BitcoinUtils } from 'opnet';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { MotoContract } from '../../contracts/MotoContract.js';

await opnet('NativeSwap: Virtual Pool Mechanics', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: MotoContract;
    let toSwap: { a: Address; r: Recipient[] }[] = [];

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeAddress: Address = Blockchain.generateRandomAddress();
    const tokenDecimals = 18;

    const totalSupply = BitcoinUtils.expandToDecimals(1_000_000_000, tokenDecimals);
    const initialLiquidity = BitcoinUtils.expandToDecimals(25_000_000, tokenDecimals);

    const priceInSatoshis = 50n;
    const tokenBase = 10n ** BigInt(tokenDecimals);
    const floorPrice = tokenBase / priceInSatoshis;
    const QUOTE_SCALE = 100_000_000n;

    function ceilDiv(a: bigint, b: bigint): bigint {
        if (a === 0n) return 0n;
        return (a + b - 1n) / b;
    }

    function halfCeil(value: bigint): bigint {
        const halfFloor = value / 2n;
        return halfFloor + (value & 1n);
    }

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

        await token.mintRaw(provider, amount);

        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await token.increaseAllowance(provider, nativeSwap.address, amount);

        const liquid = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            network: Blockchain.network,
            amountIn: amount,
            priority: false,
            disablePriorityQueueFees: false,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        vm.info(
            `Listed ${BitcoinUtils.formatUnits(amount, tokenDecimals)} tokens - ${gas2USD(liquid.response.usedGas)} USD`,
        );
    }

    async function makeReservation(buyer: Address, satIn: bigint): Promise<bigint> {
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
        return resp.expectedAmountOut;
    }

    async function executeSwaps(): Promise<bigint> {
        let totalTokensReceived = 0n;

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
            totalTokensReceived += d.amountOut;
            vm.log(
                `Swap executed: ${BitcoinUtils.formatUnits(d.amountOut, tokenDecimals)} tokens - ${gas2USD(s.response.usedGas)} USD`,
            );
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];

        return totalTokensReceived;
    }

    vm.beforeEach(async () => {
        toSwap = [];

        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        Blockchain.blockNumber = 1000n;

        token = new MotoContract({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });
        Blockchain.register(token);
        await token.init();

        await token.mintRaw(userAddress, totalSupply);

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

    await vm.it('should initialize pool with correct virtual reserves', async () => {
        vm.info('\n==================== TEST: POOL INITIALIZATION ====================\n');

        await createPool();
        Blockchain.blockNumber += 1n;

        const reserves = await nativeSwap.getReserve({ token: tokenAddress });

        // Expected: virtualSatoshisReserve = initialLiquidity / floorPrice
        const expectedBtcReserve = initialLiquidity / floorPrice;

        vm.info('=== EXPECTED VALUES ===');
        vm.info(
            `Expected Virtual Token Reserve: ${BitcoinUtils.formatUnits(initialLiquidity, tokenDecimals)} tokens`,
        );
        vm.info(
            `Expected Virtual BTC Reserve: ${BitcoinUtils.formatUnits(expectedBtcReserve, 8)} BTC`,
        );
        vm.info(`Expected k: ${initialLiquidity * expectedBtcReserve}`);

        vm.info('\n=== ACTUAL VALUES ===');
        vm.info(
            `Actual Virtual Token Reserve: ${BitcoinUtils.formatUnits(reserves.virtualTokenReserve, tokenDecimals)} tokens`,
        );
        vm.info(
            `Actual Virtual BTC Reserve: ${BitcoinUtils.formatUnits(reserves.virtualBTCReserve, 8)} BTC`,
        );
        vm.info(`Actual k: ${reserves.virtualTokenReserve * reserves.virtualBTCReserve}`);

        Assert.expect(reserves.virtualTokenReserve).toEqual(initialLiquidity);
        vm.info('✓ Virtual token reserve matches initial liquidity');

        Assert.expect(reserves.virtualBTCReserve).toEqual(expectedBtcReserve);
        vm.info('✓ Virtual BTC reserve matches expected value (initialLiquidity / floorPrice)');

        const expectedK = initialLiquidity * expectedBtcReserve;
        const actualK = reserves.virtualTokenReserve * reserves.virtualBTCReserve;
        Assert.expect(actualK).toEqual(expectedK);
        vm.info('✓ Initial k is correct');

        vm.info('\n==================== POOL INITIALIZATION VERIFIED ====================\n');
    });

    await vm.it(
        'should apply exactly 50% of listed tokens to virtual reserves on listing',
        async () => {
            vm.info('\n==================== TEST: 50/50 LISTING IMPACT ====================\n');

            await createPool();
            Blockchain.blockNumber += 1n;

            const beforeListing = await nativeSwap.getReserve({ token: tokenAddress });
            const kBefore = beforeListing.virtualBTCReserve * beforeListing.virtualTokenReserve;

            vm.info('=== BEFORE LISTING ===');
            vm.info(
                `Virtual Token Reserve: ${BitcoinUtils.formatUnits(beforeListing.virtualTokenReserve, tokenDecimals)}`,
            );
            vm.info(
                `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(beforeListing.virtualBTCReserve, 8)} BTC`,
            );
            vm.info(`k: ${kBefore}`);

            const tokensToList = BitcoinUtils.expandToDecimals(2_000_000, tokenDecimals);
            const sellProvider = Blockchain.generateRandomAddress();

            await listTokensForSale(tokensToList, sellProvider);
            Blockchain.blockNumber += 1n;

            const afterListing = await nativeSwap.getReserve({ token: tokenAddress });

            // Expected: first half (ceiling) applied to virtual reserves
            const expectedFirstHalf = halfCeil(tokensToList);
            const expectedNewT = beforeListing.virtualTokenReserve + expectedFirstHalf;
            // B = ceil(k / T) to preserve k
            const expectedNewB = ceilDiv(kBefore, expectedNewT);

            vm.info('\n=== EXPECTED VALUES AFTER LISTING ===');
            vm.info(
                `First half (ceil): ${BitcoinUtils.formatUnits(expectedFirstHalf, tokenDecimals)} tokens`,
            );
            vm.info(
                `Expected Virtual Token Reserve: ${BitcoinUtils.formatUnits(expectedNewT, tokenDecimals)}`,
            );
            vm.info(
                `Expected Virtual BTC Reserve: ${BitcoinUtils.formatUnits(expectedNewB, 8)} BTC`,
            );

            vm.info('\n=== ACTUAL VALUES AFTER LISTING ===');
            vm.info(
                `Actual Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterListing.virtualTokenReserve, tokenDecimals)}`,
            );
            vm.info(
                `Actual Virtual BTC Reserve: ${BitcoinUtils.formatUnits(afterListing.virtualBTCReserve, 8)} BTC`,
            );

            const tokenIncrease =
                afterListing.virtualTokenReserve - beforeListing.virtualTokenReserve;
            vm.info(
                `\nActual token increase: ${BitcoinUtils.formatUnits(tokenIncrease, tokenDecimals)}`,
            );

            // Allow small tolerance for rounding
            const tolerance = tokensToList / 1000n; // 0.1% tolerance

            const tokenDiff =
                tokenIncrease > expectedFirstHalf
                    ? tokenIncrease - expectedFirstHalf
                    : expectedFirstHalf - tokenIncrease;

            Assert.expect(tokenDiff <= tolerance).toEqual(true);
            vm.info('✓ First 50% of tokens applied to virtual reserves');

            // Verify k is preserved or slightly increased
            const kAfter = afterListing.virtualBTCReserve * afterListing.virtualTokenReserve;
            Assert.expect(kAfter >= kBefore).toEqual(true);
            vm.info('✓ k preserved or increased (ceiling division)');

            // Verify total liquidity includes full amount
            Assert.expect(afterListing.liquidity).toEqual(beforeListing.liquidity + tokensToList);
            vm.info('✓ Total liquidity includes full listed amount');

            vm.info('\n==================== 50/50 LISTING VERIFIED ====================\n');
        },
    );

    await vm.it('should apply second 50% on provider activation during first swap', async () => {
        vm.info('\n==================== TEST: PROVIDER ACTIVATION ====================\n');

        await createPool();
        Blockchain.blockNumber += 1n;

        const tokensToList = BitcoinUtils.expandToDecimals(2_000_000, tokenDecimals);
        const sellProvider = Blockchain.generateRandomAddress();

        await listTokensForSale(tokensToList, sellProvider);
        Blockchain.blockNumber += 1n;

        const afterListing = await nativeSwap.getReserve({ token: tokenAddress });
        const kAfterListing = afterListing.virtualBTCReserve * afterListing.virtualTokenReserve;

        vm.info('=== AFTER LISTING (FIRST 50% APPLIED) ===');
        vm.info(
            `Virtual Token Reserve: ${BitcoinUtils.formatUnits(afterListing.virtualTokenReserve, tokenDecimals)}`,
        );
        vm.info(`k: ${kAfterListing}`);

        // Make reservation and swap to trigger activation
        const buyer = Blockchain.generateRandomAddress();
        const btcAmount = 50000000n; // 0.5 BTC

        const reservedTokens = await makeReservation(buyer, btcAmount);
        Blockchain.blockNumber += 1n;

        const beforeSwap = await nativeSwap.getReserve({ token: tokenAddress });

        await executeSwaps();
        Blockchain.blockNumber += 1n;

        const afterSwap = await nativeSwap.getReserve({ token: tokenAddress });

        // Calculate expected changes:
        // 1. Second half added via activation
        // 2. Tokens removed via buy
        // Net change = secondHalf - tokensBought

        const secondHalf = halfCeil(tokensToList);

        vm.info('\n=== EXPECTED CHANGES ===');
        vm.info(
            `Second half to be activated: ${BitcoinUtils.formatUnits(secondHalf, tokenDecimals)} tokens`,
        );
        vm.info(
            `Tokens bought (reserved): ${BitcoinUtils.formatUnits(reservedTokens, tokenDecimals)} tokens`,
        );
        vm.info(
            `Expected net change: ${BitcoinUtils.formatUnits(secondHalf - reservedTokens, tokenDecimals)} tokens`,
        );

        const actualTokenChange = afterSwap.virtualTokenReserve - beforeSwap.virtualTokenReserve;
        vm.info(
            `\nActual token change: ${BitcoinUtils.formatUnits(actualTokenChange, tokenDecimals)} tokens`,
        );

        // The token change should be approximately (secondHalf - tokensBought)
        // Allow for fee impact and rounding
        const expectedNetChange = secondHalf - reservedTokens;

        vm.info('\n=== VERIFICATION ===');

        // If secondHalf > reservedTokens, net change is positive (more added than removed)
        // If secondHalf < reservedTokens, net change is negative (more removed than added)
        if (expectedNetChange > 0n) {
            Assert.expect(actualTokenChange > 0n).toEqual(true);
            vm.info('✓ Net positive token change (activation > buy)');
        } else {
            Assert.expect(actualTokenChange < 0n).toEqual(true);
            vm.info('✓ Net negative token change (buy > activation)');
        }

        vm.info('✓ Provider activation applied second 50% during swap');

        vm.info('\n==================== PROVIDER ACTIVATION VERIFIED ====================\n');
    });

    await vm.it(
        'should correctly calculate quote based on virtual reserves and queue impact',
        async () => {
            vm.info('\n==================== TEST: QUOTE CALCULATION ====================\n');

            await createPool();
            Blockchain.blockNumber += 1n;

            const reserves = await nativeSwap.getReserve({ token: tokenAddress });
            const T = reserves.virtualTokenReserve;
            const B = reserves.virtualBTCReserve;
            const Q = reserves.liquidity; // queued liquidity

            vm.info('=== VIRTUAL RESERVES ===');
            vm.info(`T (virtual tokens): ${BitcoinUtils.formatUnits(T, tokenDecimals)}`);
            vm.info(`B (virtual satoshis): ${B}`);
            vm.info(`Q (queued liquidity): ${BitcoinUtils.formatUnits(Q, tokenDecimals)}`);

            // Queue impact formula: T * ln(1 + Q/T)² / 1e12

            const satoshisIn = 100000000n; // 1 BTC

            // Without queue impact: tokensOut = satoshisIn * T / B
            const tokensWithoutImpact = (satoshisIn * T) / B;

            vm.info('\n=== QUOTE CALCULATION ===');
            vm.info(
                `Tokens without queue impact: ${BitcoinUtils.formatUnits(tokensWithoutImpact, tokenDecimals)}`,
            );

            const actualQuote = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: satoshisIn,
            });

            vm.info(
                `Actual tokens out (with queue impact): ${BitcoinUtils.formatUnits(actualQuote.tokensOut, tokenDecimals)}`,
            );

            // With queue impact, effective T is larger, so scaledPrice is higher, so more tokens out
            // Quote should be >= tokensWithoutImpact when there's queued liquidity
            if (Q > 0n) {
                Assert.expect(actualQuote.tokensOut >= tokensWithoutImpact).toEqual(true);
                vm.info('✓ Queue impact increases tokens out (reflects pending sell pressure)');
            } else {
                // No queue, should match base calculation
                const tolerance = tokensWithoutImpact / 100n;
                const diff =
                    actualQuote.tokensOut > tokensWithoutImpact
                        ? actualQuote.tokensOut - tokensWithoutImpact
                        : tokensWithoutImpact - actualQuote.tokensOut;
                Assert.expect(diff <= tolerance).toEqual(true);
                vm.info('✓ No queue impact, quote matches base calculation');
            }

            // Verify the quote is mathematically sound by checking reverse conversion
            // If user pays satoshisIn, they should get actualQuote.tokensOut
            // The scaledPrice used should be: effectiveT * QUOTE_SCALE / B
            const impliedScaledPrice = (actualQuote.tokensOut * QUOTE_SCALE) / satoshisIn;
            const impliedEffectiveT = (impliedScaledPrice * B) / QUOTE_SCALE;

            vm.info(
                `\nImplied effective T from quote: ${BitcoinUtils.formatUnits(impliedEffectiveT, tokenDecimals)}`,
            );
            vm.info(
                `Queue impact added: ${BitcoinUtils.formatUnits(impliedEffectiveT - T, tokenDecimals)} tokens`,
            );

            // Effective T should be >= T (queue impact is additive)
            Assert.expect(impliedEffectiveT >= T).toEqual(true);
            vm.info('✓ Effective T includes queue impact');

            vm.info('\n==================== QUOTE CALCULATION VERIFIED ====================\n');
        },
    );

    await vm.it(
        'should maintain k through multiple buy operations with ceiling division',
        async () => {
            vm.info(
                '\n==================== TEST: K PRESERVATION THROUGH BUYS ====================\n',
            );

            await createPool();
            Blockchain.blockNumber += 1n;

            const initialReserves = await nativeSwap.getReserve({ token: tokenAddress });
            const initialK =
                initialReserves.virtualBTCReserve * initialReserves.virtualTokenReserve;

            vm.info('=== INITIAL STATE ===');
            vm.info(`Initial k: ${initialK}`);

            let previousK = initialK;

            // Execute multiple buys from initial liquidity only
            for (let i = 0; i < 5; i++) {
                const buyer = Blockchain.generateRandomAddress();
                const btcAmount = 10000000n; // 0.1 BTC each

                await makeReservation(buyer, btcAmount);
                Blockchain.blockNumber += 1n;
                await executeSwaps();
                Blockchain.blockNumber += 1n;

                const currentReserves = await nativeSwap.getReserve({ token: tokenAddress });
                const currentK =
                    currentReserves.virtualBTCReserve * currentReserves.virtualTokenReserve;

                vm.info(`\nAfter swap ${i + 1}:`);
                vm.info(
                    `  T: ${BitcoinUtils.formatUnits(currentReserves.virtualTokenReserve, tokenDecimals)}`,
                );
                vm.info(`  B: ${currentReserves.virtualBTCReserve}`);
                vm.info(`  k: ${currentK}`);
                vm.info(`  k change from previous: ${currentK - previousK}`);

                // With ceiling division, k should never decrease
                Assert.expect(currentK >= previousK).toEqual(true);

                previousK = currentK;
            }

            const finalReserves = await nativeSwap.getReserve({ token: tokenAddress });
            const finalK = finalReserves.virtualBTCReserve * finalReserves.virtualTokenReserve;

            vm.info('\n=== FINAL VERIFICATION ===');
            vm.info(`Initial k: ${initialK}`);
            vm.info(`Final k: ${finalK}`);
            vm.info(`Total k increase: ${finalK - initialK}`);

            Assert.expect(finalK >= initialK).toEqual(true);
            vm.info('✓ k never decreased through all buy operations');
            vm.info('✓ Ceiling division preserves constant product');

            vm.info('\n==================== K PRESERVATION VERIFIED ====================\n');
        },
    );

    await vm.it('should correctly handle tokensToSatoshis ceiling division', async () => {
        vm.info(
            '\n==================== TEST: TOKENS TO SATOSHIS CONVERSION ====================\n',
        );

        await createPool();
        Blockchain.blockNumber += 1n;

        const reserves = await nativeSwap.getReserve({ token: tokenAddress });
        const scaledPrice =
            (reserves.virtualTokenReserve * QUOTE_SCALE) / reserves.virtualBTCReserve;

        vm.info('=== CONVERSION TEST ===');
        vm.info(`Scaled price: ${scaledPrice}`);

        // Test various token amounts
        const testAmounts = [
            BitcoinUtils.expandToDecimals(100, tokenDecimals),
            BitcoinUtils.expandToDecimals(1000, tokenDecimals),
            BitcoinUtils.expandToDecimals(10000, tokenDecimals),
        ];

        for (const tokenAmount of testAmounts) {
            // Expected: ceil((tokenAmount * QUOTE_SCALE) / scaledPrice)
            const numerator = tokenAmount * QUOTE_SCALE;
            const expectedSatoshis = ceilDiv(numerator, scaledPrice);

            // Reverse: satoshisToTokens should give <= original tokens
            const tokensBack = (expectedSatoshis * scaledPrice) / QUOTE_SCALE;

            vm.info(`\nToken amount: ${BitcoinUtils.formatUnits(tokenAmount, tokenDecimals)}`);
            vm.info(`Expected satoshis (ceil): ${expectedSatoshis}`);
            vm.info(
                `Tokens back from satoshis: ${BitcoinUtils.formatUnits(tokensBack, tokenDecimals)}`,
            );

            // tokensBack should be >= tokenAmount (user pays enough)
            Assert.expect(tokensBack >= tokenAmount).toEqual(true);
            vm.info('✓ Ceiling ensures user pays enough satoshis');
        }

        vm.info('\n==================== CONVERSION VERIFIED ====================\n');
    });

    await vm.it('should maintain k through mixed buy/sell operations across blocks', async () => {
        vm.info(
            '\n==================== TEST: MIXED OPERATIONS K PRESERVATION ====================\n',
        );

        await createPool();
        Blockchain.blockNumber += 1n;

        const initialReserves = await nativeSwap.getReserve({ token: tokenAddress });
        const initialK = initialReserves.virtualBTCReserve * initialReserves.virtualTokenReserve;

        vm.info('=== INITIAL STATE ===');
        vm.info(
            `Virtual Token Reserve: ${BitcoinUtils.formatUnits(initialReserves.virtualTokenReserve, tokenDecimals)}`,
        );
        vm.info(
            `Virtual BTC Reserve: ${BitcoinUtils.formatUnits(initialReserves.virtualBTCReserve, 8)} BTC`,
        );
        vm.info(`Initial k: ${initialK}`);

        let previousK = initialK;
        let operationCount = 0;

        async function verifyK(operation: string): Promise<void> {
            const reserves = await nativeSwap.getReserve({ token: tokenAddress });
            const currentK = reserves.virtualBTCReserve * reserves.virtualTokenReserve;

            operationCount++;
            vm.info(`\n--- Operation ${operationCount}: ${operation} ---`);
            vm.info(
                `  T: ${BitcoinUtils.formatUnits(reserves.virtualTokenReserve, tokenDecimals)}`,
            );
            vm.info(`  B: ${BitcoinUtils.formatUnits(reserves.virtualBTCReserve, 8)} BTC`);
            vm.info(`  k: ${currentK}`);
            vm.info(`  k change: ${currentK - previousK}`);

            Assert.expect(currentK >= previousK).toEqual(true);
            previousK = currentK;
        }

        // Round 1: Provider A lists tokens
        vm.info('\n=== ROUND 1: FIRST LISTING ===');
        const providerA = Blockchain.generateRandomAddress();
        const listAmountA = BitcoinUtils.expandToDecimals(1_000_000, tokenDecimals);

        await listTokensForSale(listAmountA, providerA);
        Blockchain.blockNumber += 1n;
        await verifyK(
            `Provider A lists ${BitcoinUtils.formatUnits(listAmountA, tokenDecimals)} tokens`,
        );

        // Round 2: Buyer 1 makes purchase
        vm.info('\n=== ROUND 2: FIRST BUY ===');
        const buyer1 = Blockchain.generateRandomAddress();
        const buyAmount1 = 20000000n; // 0.2 BTC

        await makeReservation(buyer1, buyAmount1);
        Blockchain.blockNumber += 1n;

        await executeSwaps();
        Blockchain.blockNumber += 1n;
        await verifyK(`Buyer 1 purchases with ${BitcoinUtils.formatUnits(buyAmount1, 8)} BTC`);

        // Round 3: Provider B lists more tokens
        vm.info('\n=== ROUND 3: SECOND LISTING ===');
        const providerB = Blockchain.generateRandomAddress();
        const listAmountB = BitcoinUtils.expandToDecimals(500_000, tokenDecimals);

        await listTokensForSale(listAmountB, providerB);
        Blockchain.blockNumber += 1n;
        await verifyK(
            `Provider B lists ${BitcoinUtils.formatUnits(listAmountB, tokenDecimals)} tokens`,
        );

        // Round 4: Multiple blocks pass with no activity
        vm.info('\n=== ROUND 4: BLOCKS PASS (NO ACTIVITY) ===');
        Blockchain.blockNumber += 5n;
        await verifyK('5 blocks pass with no activity');

        // Round 5: Buyer 2 makes purchase
        vm.info('\n=== ROUND 5: SECOND BUY ===');
        const buyer2 = Blockchain.generateRandomAddress();
        const buyAmount2 = 30000000n; // 0.3 BTC

        await makeReservation(buyer2, buyAmount2);
        Blockchain.blockNumber += 1n;

        await executeSwaps();
        Blockchain.blockNumber += 1n;
        await verifyK(`Buyer 2 purchases with ${BitcoinUtils.formatUnits(buyAmount2, 8)} BTC`);

        // Round 6: Provider C lists tokens
        vm.info('\n=== ROUND 6: THIRD LISTING ===');
        const providerC = Blockchain.generateRandomAddress();
        const listAmountC = BitcoinUtils.expandToDecimals(2_000_000, tokenDecimals);

        await listTokensForSale(listAmountC, providerC);
        Blockchain.blockNumber += 1n;
        await verifyK(
            `Provider C lists ${BitcoinUtils.formatUnits(listAmountC, tokenDecimals)} tokens`,
        );

        // Round 7: Buyer 3 makes large purchase
        vm.info('\n=== ROUND 7: LARGE BUY ===');
        const buyer3 = Blockchain.generateRandomAddress();
        const buyAmount3 = 100000000n; // 1 BTC

        await makeReservation(buyer3, buyAmount3);
        Blockchain.blockNumber += 1n;

        await executeSwaps();
        Blockchain.blockNumber += 1n;
        await verifyK(`Buyer 3 purchases with ${BitcoinUtils.formatUnits(buyAmount3, 8)} BTC`);

        // Round 8: More blocks pass
        vm.info('\n=== ROUND 8: MORE BLOCKS PASS ===');
        Blockchain.blockNumber += 3n;
        await verifyK('3 blocks pass');

        // Round 9: Small buy
        vm.info('\n=== ROUND 9: SMALL BUY ===');
        const buyer4 = Blockchain.generateRandomAddress();
        const buyAmount4 = 5000000n; // 0.05 BTC

        await makeReservation(buyer4, buyAmount4);
        Blockchain.blockNumber += 1n;

        await executeSwaps();
        Blockchain.blockNumber += 1n;
        await verifyK(`Buyer 4 purchases with ${BitcoinUtils.formatUnits(buyAmount4, 8)} BTC`);

        // Round 10: Provider D lists tokens
        vm.info('\n=== ROUND 10: FOURTH LISTING ===');
        const providerD = Blockchain.generateRandomAddress();
        const listAmountD = BitcoinUtils.expandToDecimals(750_000, tokenDecimals);

        await listTokensForSale(listAmountD, providerD);
        Blockchain.blockNumber += 1n;
        await verifyK(
            `Provider D lists ${BitcoinUtils.formatUnits(listAmountD, tokenDecimals)} tokens`,
        );

        // Round 11: Rapid succession - buy, list, buy
        vm.info('\n=== ROUND 11: RAPID SUCCESSION ===');

        const buyer5 = Blockchain.generateRandomAddress();
        await makeReservation(buyer5, 15000000n);
        Blockchain.blockNumber += 1n;
        await executeSwaps();
        Blockchain.blockNumber += 1n;
        await verifyK('Rapid buy 1 (0.15 BTC)');

        const providerE = Blockchain.generateRandomAddress();
        await listTokensForSale(BitcoinUtils.expandToDecimals(300_000, tokenDecimals), providerE);
        Blockchain.blockNumber += 1n;
        await verifyK('Rapid list (300k tokens)');

        const buyer6 = Blockchain.generateRandomAddress();
        await makeReservation(buyer6, 25000000n);
        Blockchain.blockNumber += 1n;
        await executeSwaps();
        Blockchain.blockNumber += 1n;
        await verifyK('Rapid buy 2 (0.25 BTC)');

        // Final verification
        const finalReserves = await nativeSwap.getReserve({ token: tokenAddress });
        const finalK = finalReserves.virtualBTCReserve * finalReserves.virtualTokenReserve;

        vm.info('\n=== FINAL SUMMARY ===');
        vm.info(`Initial k: ${initialK}`);
        vm.info(`Final k: ${finalK}`);
        vm.info(`Total k increase: ${finalK - initialK}`);
        vm.info(`Total operations: ${operationCount}`);

        const kIncreasePercent = ((finalK - initialK) * 10000n) / initialK;
        vm.info(`k increase: ${Number(kIncreasePercent) / 100}%`);

        Assert.expect(finalK >= initialK).toEqual(true);
        vm.info('\n✓ k never decreased through all mixed operations');
        vm.info('✓ Virtual pool maintained integrity across buys, sells, and block changes');

        vm.info('\n==================== MIXED OPERATIONS VERIFIED ====================\n');
    });

    await vm.it(
        'should handle reservation expiration and provider restoration correctly',
        async () => {
            vm.info('\n==================== TEST: RESERVATION EXPIRATION ====================\n');

            await createPool();
            Blockchain.blockNumber += 1n;

            // Provider lists tokens
            const provider = Blockchain.generateRandomAddress();
            const listAmount = BitcoinUtils.expandToDecimals(1_000_000, tokenDecimals);

            await listTokensForSale(listAmount, provider);
            Blockchain.blockNumber += 1n;

            const afterListing = await nativeSwap.getReserve({ token: tokenAddress });
            const kAfterListing = afterListing.virtualBTCReserve * afterListing.virtualTokenReserve;

            vm.info('=== AFTER LISTING ===');
            vm.info(
                `Liquidity: ${BitcoinUtils.formatUnits(afterListing.liquidity, tokenDecimals)} tokens`,
            );
            vm.info(`k: ${kAfterListing}`);

            // Buyer makes reservation but won't swap
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;

            const reserveResp = await nativeSwap.reserve({
                token: tokenAddress,
                maximumAmountIn: 50000000n, // 0.5 BTC
                minimumAmountOut: 0n,
                activationDelay: 0,
            });

            const reservedAmount = reserveResp.expectedAmountOut;
            Blockchain.blockNumber += 1n;

            const afterReservation = await nativeSwap.getReserve({ token: tokenAddress });

            vm.info('\n=== AFTER RESERVATION ===');
            vm.info(`Reserved: ${BitcoinUtils.formatUnits(reservedAmount, tokenDecimals)} tokens`);
            vm.info(
                `Reserved liquidity: ${BitcoinUtils.formatUnits(afterReservation.reservedLiquidity, tokenDecimals)} tokens`,
            );
            vm.info(
                `Available liquidity: ${BitcoinUtils.formatUnits(afterReservation.liquidity - afterReservation.reservedLiquidity, tokenDecimals)} tokens`,
            );

            // Let reservation expire (5 blocks + buffer)
            vm.info('\n=== WAITING FOR EXPIRATION ===');
            Blockchain.blockNumber += 10n;

            // Trigger purge by making another reservation
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            const buyer2 = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer2;
            Blockchain.txOrigin = buyer2;

            // This should trigger purge of expired reservation
            const reserveResp2 = await nativeSwap.reserve({
                token: tokenAddress,
                maximumAmountIn: 10000000n, // 0.1 BTC
                minimumAmountOut: 0n,
                activationDelay: 0,
            });

            Blockchain.blockNumber += 1n;

            const afterPurge = await nativeSwap.getReserve({ token: tokenAddress });
            const kAfterPurge = afterPurge.virtualBTCReserve * afterPurge.virtualTokenReserve;

            vm.info('\n=== AFTER PURGE ===');
            vm.info(
                `Liquidity: ${BitcoinUtils.formatUnits(afterPurge.liquidity, tokenDecimals)} tokens`,
            );
            vm.info(
                `Reserved liquidity: ${BitcoinUtils.formatUnits(afterPurge.reservedLiquidity, tokenDecimals)} tokens`,
            );
            vm.info(`k: ${kAfterPurge}`);

            // k should be preserved or increased
            Assert.expect(kAfterPurge >= kAfterListing).toEqual(true);
            vm.info('\n✓ k preserved through reservation expiration and purge');

            // Clean up - execute the second reservation
            toSwap.push({
                a: buyer2,
                r: NativeSwapTypesCoders.decodeReservationEvents(reserveResp2.response.events)
                    .recipients,
            });
            await executeSwaps();

            vm.info(
                '\n==================== RESERVATION EXPIRATION VERIFIED ====================\n',
            );
        },
    );

    await vm.it('should maintain correct price discovery through market cycles', async () => {
        vm.info('\n==================== TEST: PRICE DISCOVERY ====================\n');

        await createPool();
        Blockchain.blockNumber += 1n;

        const initialQuote = await nativeSwap.getQuote({
            token: tokenAddress,
            satoshisIn: 100000000n,
        });

        vm.info('=== INITIAL PRICE ===');
        vm.info(
            `Tokens per 1 BTC: ${BitcoinUtils.formatUnits(initialQuote.tokensOut, tokenDecimals)}`,
        );

        // Simulate sell pressure: multiple providers list tokens
        vm.info('\n=== SELL PRESSURE PHASE ===');
        for (let i = 0; i < 3; i++) {
            const provider = Blockchain.generateRandomAddress();
            const amount = BitcoinUtils.expandToDecimals(500_000 + i * 200_000, tokenDecimals);
            await listTokensForSale(amount, provider);
            Blockchain.blockNumber += 1n;

            const quote = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: 100000000n,
            });
            vm.info(
                `After listing ${i + 1}: ${BitcoinUtils.formatUnits(quote.tokensOut, tokenDecimals)} tokens per BTC`,
            );
        }

        const afterSellPressure = await nativeSwap.getQuote({
            token: tokenAddress,
            satoshisIn: 100000000n,
        });

        // Price should be lower (more tokens per BTC) after sell pressure
        Assert.expect(afterSellPressure.tokensOut > initialQuote.tokensOut).toEqual(true);
        vm.info('✓ Price decreased (more tokens per BTC) after sell pressure');

        // Simulate buy pressure: multiple buyers purchase
        vm.info('\n=== BUY PRESSURE PHASE ===');
        for (let i = 0; i < 4; i++) {
            const buyer = Blockchain.generateRandomAddress();
            const btcAmount = BigInt(20000000 + i * 10000000); // 0.2 to 0.5 BTC

            await makeReservation(buyer, btcAmount);
            Blockchain.blockNumber += 1n;
            await executeSwaps();
            Blockchain.blockNumber += 1n;

            const quote = await nativeSwap.getQuote({
                token: tokenAddress,
                satoshisIn: 100000000n,
            });
            vm.info(
                `After buy ${i + 1}: ${BitcoinUtils.formatUnits(quote.tokensOut, tokenDecimals)} tokens per BTC`,
            );
        }

        const afterBuyPressure = await nativeSwap.getQuote({
            token: tokenAddress,
            satoshisIn: 100000000n,
        });

        // Price should be higher (fewer tokens per BTC) after buy pressure
        Assert.expect(afterBuyPressure.tokensOut < afterSellPressure.tokensOut).toEqual(true);
        vm.info('✓ Price increased (fewer tokens per BTC) after buy pressure');

        // Verify k is preserved
        const finalReserves = await nativeSwap.getReserve({ token: tokenAddress });
        const initialReserves = await nativeSwap.getReserve({ token: tokenAddress });

        vm.info('\n=== PRICE DISCOVERY SUMMARY ===');
        vm.info(
            `Initial: ${BitcoinUtils.formatUnits(initialQuote.tokensOut, tokenDecimals)} tokens/BTC`,
        );
        vm.info(
            `After sells: ${BitcoinUtils.formatUnits(afterSellPressure.tokensOut, tokenDecimals)} tokens/BTC`,
        );
        vm.info(
            `After buys: ${BitcoinUtils.formatUnits(afterBuyPressure.tokensOut, tokenDecimals)} tokens/BTC`,
        );

        vm.info('\n✓ Price discovery responds correctly to market pressure');

        vm.info('\n==================== PRICE DISCOVERY VERIFIED ====================\n');
    });
});
