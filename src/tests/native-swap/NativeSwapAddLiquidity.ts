import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    CallResponse,
    OP_20,
    opnet,
    OPNetUnit,
} from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';
import { gas2BTC, gas2Sat, gas2USD } from '../orderbook/utils/OrderBookUtils.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet(
    'EWMA: Priority and Normal Queue addLiquidity Comprehensive Tests',
    async (vm: OPNetUnit) => {
        let ewma: EWMA;
        let token: OP_20;

        const userAddress: Address = receiver;
        const tokenAddress: Address = Blockchain.generateRandomAddress();
        const ewmaAddress: Address = Blockchain.generateRandomAddress();

        async function setQuote(p0: bigint): Promise<void> {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            const quote = await ewma.setQuote(tokenAddress, p0);
            vm.debug(
                `Quote set! Gas cost: ${gas2Sat(quote.usedGas)} sat (${gas2BTC(quote.usedGas)} BTC, $${gas2USD(quote.usedGas)})`,
            );
        }

        vm.beforeEach(async () => {
            Blockchain.dispose();
            Blockchain.clearContracts();
            await Blockchain.init();

            token = new OP_20({
                file: 'MyToken',
                deployer: userAddress,
                address: tokenAddress,
                decimals: 18,
            });
            Blockchain.register(token);
            await token.init();

            // Mint tokens to the user
            await token.mint(userAddress, 10_000_000);

            ewma = new EWMA(userAddress, ewmaAddress);
            Blockchain.register(ewma);
            await ewma.init();
            Blockchain.msgSender = userAddress;

            // Set a base quote
            await setQuote(Blockchain.expandToDecimal(1, 8)); // 1 sat per token
        });

        vm.afterEach(() => {
            ewma.dispose();
            token.dispose();
            Blockchain.dispose();
        });

        // Test 1: Add liquidity to normal queue
        await vm.it('should add liquidity to the normal queue successfully', async () => {
            const amountIn = Blockchain.expandTo18Decimals(500);
            await token.approve(userAddress, ewma.address, amountIn);

            const initialUserBalance = await token.balanceOf(userAddress);
            const initialContractBalance = await token.balanceOf(ewma.address);

            const resp: CallResponse = await ewma.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                amountIn,
                false,
            );

            Assert.expect(resp.error).toBeUndefined();
            const finalUserBalance = await token.balanceOf(userAddress);
            const finalContractBalance = await token.balanceOf(ewma.address);

            // Confirm tokens moved
            Assert.expect(finalUserBalance).toEqual(initialUserBalance - amountIn);
            Assert.expect(finalContractBalance).toEqual(initialContractBalance + amountIn);

            // Check events
            const events = resp.events;
            const liquidityAddedEvt = events.find((e) => e.type === 'LiquidityAdded');
            if (!liquidityAddedEvt) {
                throw new Error('No LiquidityAdded event found for normal queue');
            }

            const decoded = EWMA.decodeLiquidityAddedEvent(liquidityAddedEvt.data);
            Assert.expect(decoded.totalLiquidity).toEqual(amountIn);
            Assert.expect(decoded.receiver).toEqual(userAddress.p2tr(Blockchain.network));
        });

        // Test 2: Add liquidity to priority queue
        await vm.it(
            'should add liquidity to the priority queue successfully and apply fee',
            async () => {
                const amountIn = Blockchain.expandTo18Decimals(1000);
                await token.approve(userAddress, ewma.address, amountIn);

                const initialUserBalance = await token.balanceOf(userAddress);
                const initialContractBalance = await token.balanceOf(ewma.address);
                const initialDeadBalance = await token.balanceOf(Address.dead());

                // Priority mode: 3% fee to dead address by default logic
                const resp = await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                    true,
                );

                Assert.expect(resp.error).toBeUndefined();

                const feeAmount = (amountIn * 3n) / 100n;
                const finalUserBalance = await token.balanceOf(userAddress);
                const finalContractBalance = await token.balanceOf(ewma.address);
                const finalDeadBalance = await token.balanceOf(Address.dead());

                Assert.expect(finalDeadBalance - initialDeadBalance).toEqual(feeAmount);
                Assert.expect(finalContractBalance - initialContractBalance).toEqual(
                    amountIn - feeAmount,
                );
                Assert.expect(initialUserBalance - finalUserBalance).toEqual(amountIn);

                const events = resp.events;
                const liquidityAddedEvt = events.find((e) => e.type === 'LiquidityAdded');
                if (!liquidityAddedEvt) {
                    throw new Error('No LiquidityAdded event found for priority queue');
                }

                const decoded = EWMA.decodeLiquidityAddedEvent(liquidityAddedEvt.data);
                console.log(amountIn, feeAmount);
                Assert.expect(decoded.totalLiquidity).toEqual(amountIn - feeAmount);
            },
        );

        // Test 3: Attempt adding liquidity to priority queue multiple times
        await vm.it(
            'should allow multiple additions to priority queue for the same provider',
            async () => {
                const amountIn = Blockchain.expandTo18Decimals(500);
                await token.approve(userAddress, ewma.address, amountIn * 2n);

                // First addition
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                    true,
                );

                // Second addition
                const resp = await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                    true,
                );
                Assert.expect(resp.error).toBeUndefined();

                const reserve = await ewma.getReserve(tokenAddress);

                // Check total liquidity (minus fee)
                const feeForEach = (amountIn * 3n) / 100n;
                const totalLiquidityExpected = (amountIn - feeForEach) * 2n;
                Assert.expect(reserve.liquidity).toEqual(totalLiquidityExpected);
            },
        );

        // Test 4: Attempt adding liquidity to normal queue after having a priority queue position
        await vm.it(
            'should not allow adding normal queue liquidity if provider is already priority',
            async () => {
                const amountIn = Blockchain.expandTo18Decimals(100);
                await token.approve(userAddress, ewma.address, amountIn * 2n);

                // Add to priority first
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                    true,
                );

                // Try adding to normal queue
                await Assert.expect(async () => {
                    await ewma.addLiquidity(
                        tokenAddress,
                        userAddress.p2tr(Blockchain.network),
                        amountIn,
                        false,
                    );
                }).toThrow(
                    'You already have an active position in the priority queue. Please use the priority queue.',
                );
            },
        );

        await vm.it(
            'should allow transitioning from normal queue to priority and apply correct taxes',
            async () => {
                const feeRate = 3n; // 3%
                const amountIn = Blockchain.expandTo18Decimals(100); // Example amount
                // Approve enough tokens
                await token.approve(userAddress, ewma.address, amountIn * 2n);

                // Step 1: Add liquidity normally (no tax)
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                    false,
                );

                // After this step:
                // Provider liquidity = amountIn

                // Step 2: Add liquidity in priority mode
                const resp = await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                    true,
                );
                Assert.expect(resp.error).toBeUndefined();

                // Calculate expected final liquidity
                // tax = 3% of amountIn = (amountIn * 3/100)
                const tax = (amountIn * feeRate) / 100n;

                const finalLiquidity = 2n * amountIn - 2n * tax;

                const reserve = await ewma.getReserve(tokenAddress);
                Assert.expect(reserve.liquidity).toEqual(finalLiquidity);
            },
        );

        // Test 6: Attempt adding liquidity with zero amount
        await vm.it('should fail adding liquidity with zero amount', async () => {
            await token.approve(userAddress, ewma.address, 0n);
            await Assert.expect(async () => {
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    0n,
                    false,
                );
            }).toThrow('Amount in cannot be zero');
        });

        // Test 7: Attempt adding liquidity with no quote set
        await vm.it('should fail if no p0 (quote) is set', async () => {
            // Re-init a scenario with no quote
            Blockchain.dispose();
            Blockchain.clearContracts();
            await Blockchain.init();

            token = new OP_20({
                file: 'MyToken',
                deployer: userAddress,
                address: tokenAddress,
                decimals: 18,
            });
            Blockchain.register(token);
            await token.init();
            await token.mint(userAddress, 10_000_000);

            ewma = new EWMA(userAddress, ewmaAddress);
            Blockchain.register(ewma);
            await ewma.init();
            Blockchain.msgSender = userAddress;

            const amountIn = Blockchain.expandTo18Decimals(100);
            await token.approve(userAddress, ewma.address, amountIn);

            // No setQuote called
            await Assert.expect(async () => {
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amountIn,
                );
            }).toThrow('Quote is zero');
        });

        // Test 8: Ensure minimum liquidity in sat terms enforced
        await vm.it('should fail if liquidity in sat value is too low', async () => {
            // Set a very high p0 to reduce amountIn's sat value
            Blockchain.msgSender = userAddress;
            await ewma.resetStates();

            await setQuote(Blockchain.expandToDecimal(100_000, 8));

            // With a huge p0, a small amountIn is less satoshis worth
            const smallAmount = 10_000n;
            await token.approve(userAddress, ewma.address, smallAmount);

            await Assert.expect(async () => {
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    smallAmount,
                );
            }).toThrow('Liquidity value is too low');
        });

        // Test 9: Attempt changing receiver after liquidity is reserved
        await vm.it('should fail if changing receiver when liquidity is reserved', async () => {
            // Add liquidity once normally
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.approve(userAddress, ewma.address, amountIn * 2n);
            await ewma.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                amountIn,
                false,
            );

            // Simulate a scenario where provider gets reserved by making a reservation
            // We'll just trust the code that if reserved != 0, can't change receiver.
            // To do that, we actually need a second user to create a reservation:
            Blockchain.msgSender = Blockchain.generateRandomAddress();
            await Assert.expect(async () => {
                await ewma.reserve(tokenAddress, 100_000_000_000n, 1n);

                Blockchain.msgSender = userAddress;
                await ewma.addLiquidity(
                    tokenAddress,
                    Blockchain.generateRandomAddress().p2tr(Blockchain.network),
                    amountIn,
                    false,
                );
            }).toThrow('Cannot change receiver address');
        });

        // Test 10: Add huge liquidity amount to test overflow conditions
        /*await vm.it('should handle huge liquidity additions without overflow', async () => {
            const hugeAmount = 340_282_366_920_938_463_463_374_607_431_768_211_455n; // max supply of 340282366920938463463n tokens
            await token.mintRaw(userAddress, hugeAmount);
            await token.approve(userAddress, ewma.address, hugeAmount);
            await Assert.expect(async () => {
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    hugeAmount,
                    false,
                );
            }).toNotThrow();
        });*/

        // Test 11: Multiple providers adding liquidity to both normal and priority queues
        await vm.it(
            'should handle multiple providers adding liquidity to both queues',
            async () => {
                const provider1 = Blockchain.generateRandomAddress();
                const provider2 = Blockchain.generateRandomAddress();

                const amt = Blockchain.expandTo18Decimals(1000);
                await token.mintRaw(provider1, amt * 2n);
                await token.mintRaw(provider2, amt * 2n);

                // Provider1: normal queue
                Blockchain.msgSender = provider1;
                Blockchain.txOrigin = provider1;
                await token.approve(provider1, ewma.address, amt);
                await ewma.addLiquidity(
                    tokenAddress,
                    provider1.p2tr(Blockchain.network),
                    amt,
                    false,
                );

                // Provider2: priority queue
                Blockchain.msgSender = provider2;
                Blockchain.txOrigin = provider2;
                await token.approve(provider2, ewma.address, amt);
                await ewma.addLiquidity(
                    tokenAddress,
                    provider2.p2tr(Blockchain.network),
                    amt,
                    true,
                );

                // Check total reserve: sum of normal + (amt - fee)
                const feeAmt = (amt * 3n) / 100n;
                const expectedLiquidity = amt + (amt - feeAmt);
                const reserve = await ewma.getReserve(tokenAddress);
                Assert.expect(reserve.liquidity).toEqual(expectedLiquidity);
            },
        );

        // Test 12: Ensure after adding liquidity multiple times, EWMA updates are reflected
        await vm.it(
            'should update EWMA after multiple liquidity additions and not revert',
            async () => {
                // TODO, make the base price not p0 so we can verify this, add swaps verifications.
                const amt = Blockchain.expandTo18Decimals(5000);
                await token.approve(userAddress, ewma.address, amt);
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amt,
                    false,
                );

                const reservation = await ewma.reserve(tokenAddress, 100_000_000_000n, 1n);
                const decodedReservation2 = ewma.decodeReservationEvents(
                    reservation.response.events,
                );
                createRecipientUTXOs(decodedReservation2.recipients);

                Blockchain.blockNumber = Blockchain.blockNumber + 1n;

                await ewma.swap(tokenAddress, false);

                // Advance block
                Blockchain.blockNumber = Blockchain.blockNumber + 10n;

                // Add more liquidity
                await token.approve(userAddress, ewma.address, amt);
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amt,
                    true,
                );

                // If EWMA update logic was incorrect, it might revert. We just ensure it doesn't revert.
                // No explicit assert needed besides no error thrown.
                const finalReserve = await ewma.getReserve(tokenAddress);
                Assert.expect(finalReserve.liquidity).toBeGreaterThan(0n);
            },
        );

        // Test 13: Attempt adding liquidity from a different user after one user is in priority queue
        await vm.it(
            'should allow another user to add liquidity to normal queue if one user is in priority',
            async () => {
                const user2 = Blockchain.generateRandomAddress();
                const amt = Blockchain.expandTo18Decimals(1000);

                await token.mintRaw(user2, amt);
                await token.approve(userAddress, ewma.address, amt);
                await token.approve(user2, ewma.address, amt);

                // userAddress: add priority
                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    amt,
                    true,
                );

                // user2: add normal
                Blockchain.msgSender = user2;
                Blockchain.txOrigin = user2;
                const resp = await ewma.addLiquidity(
                    tokenAddress,
                    user2.p2tr(Blockchain.network),
                    amt,
                    false,
                );
                Assert.expect(resp.error).toBeUndefined();

                // Confirm both are present
                const feeAmt = (amt * 3n) / 100n;
                const expectedLiquidity = amt - feeAmt + amt;
                const reserve = await ewma.getReserve(tokenAddress);
                Assert.expect(reserve.liquidity).toEqual(expectedLiquidity);
            },
        );

        // Test 14: Verify reservation picks from priority provider first
        await vm.it('should reserve liquidity from priority providers first', async () => {
            // Setup:
            // Provider1: Priority queue
            // Provider2: Normal queue
            const provider1 = Blockchain.generateRandomAddress();
            const provider2 = Blockchain.generateRandomAddress();

            const amt = Blockchain.expandTo18Decimals(1000);
            await token.mintRaw(provider1, amt);
            await token.mintRaw(provider2, amt);

            // Provider1: priority queue
            Blockchain.msgSender = provider1;
            Blockchain.txOrigin = provider1;
            await token.approve(provider1, ewma.address, amt);
            await ewma.addLiquidity(tokenAddress, provider1.p2tr(Blockchain.network), amt, true);

            // Provider2: normal queue
            Blockchain.msgSender = provider2;
            Blockchain.txOrigin = provider2;
            await token.approve(provider2, ewma.address, amt);
            await ewma.addLiquidity(tokenAddress, provider2.p2tr(Blockchain.network), amt, false);

            // Buyer: tries to reserve liquidity
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;

            // Attempt to reserve some liquidity
            const satIn = 10000n; // Enough satoshis to cover some liquidity
            const minOut = 1n; // minimal output just for testing
            const reservationResponse = await ewma.reserve(tokenAddress, satIn, minOut);

            Assert.expect(reservationResponse.response.error).toBeUndefined();
            const decodedReservation = ewma.decodeReservationEvents(
                reservationResponse.response.events,
            );

            // Check that reservation recipients include provider1 first (priority)
            // The decodeReservationEvents logic is user-defined. We assume it returns a list of recipients.
            // The first reserved liquidity should come from the priority provider.
            // Since provider1 is priority, expect that the reservation recipients contain provider1's deposit address first.
            const priorityProviderRecipient = decodedReservation.recipients[0];
            Assert.expect(priorityProviderRecipient.address).toEqual(
                provider1.p2tr(Blockchain.network),
            );
        });

        // Test 15: After reservation, provider cannot change receiver
        await vm.it(
            'should not prevent changing provider receiver address after swap',
            async () => {
                const amountIn = Blockchain.expandTo18Decimals(500);
                // Setup a single provider with normal liquidity
                const provider = Blockchain.generateRandomAddress();
                await token.mintRaw(provider, amountIn * 2n);
                Blockchain.msgSender = provider;
                Blockchain.txOrigin = provider;
                await token.approve(provider, ewma.address, amountIn * 2n);
                await ewma.addLiquidity(
                    tokenAddress,
                    provider.p2tr(Blockchain.network),
                    amountIn,
                    false,
                );

                // Make a reservation from a different user
                const buyer = Blockchain.generateRandomAddress();
                Blockchain.msgSender = buyer;
                Blockchain.txOrigin = buyer;

                const satIn = 100_000_000n;
                const minOut = 1n;
                const reservation = await ewma.reserve(tokenAddress, satIn, minOut);
                const decodedReservation2 = ewma.decodeReservationEvents(
                    reservation.response.events,
                );

                createRecipientUTXOs(decodedReservation2.recipients);
                Blockchain.blockNumber = Blockchain.blockNumber + 1n;

                await ewma.swap(tokenAddress, false);

                // Now the provider tries to add more liquidity with a different receiver
                const newReceiver = Blockchain.generateRandomAddress().p2tr(Blockchain.network);
                Blockchain.msgSender = provider;

                await ewma.addLiquidity(tokenAddress, newReceiver, amountIn, false);
            },
        );

        // Test 16: Reservation expiration restores liquidity
        await vm.it('should restore liquidity after reservation expiration', async () => {
            // Setup a provider and make a reservation that won't be completed
            const amountIn = Blockchain.expandTo18Decimals(500);
            const provider = Blockchain.generateRandomAddress();
            await token.mintRaw(provider, amountIn);
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await token.approve(provider, ewma.address, amountIn);
            await ewma.addLiquidity(
                tokenAddress,
                provider.p2tr(Blockchain.network),
                amountIn,
                false,
            );

            // Make a reservation
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            const satIn = 50_000_000n;
            const minOut = 1n;
            const reservation = await ewma.reserve(tokenAddress, satIn, minOut);
            Assert.expect(reservation.response.error).toBeUndefined();

            // Fast forward past reservation expiration
            Blockchain.blockNumber = Blockchain.blockNumber + 10n; // More than 5 blocks (RESERVATION_EXPIRE_AFTER)

            // Trigger purging by making another action that would cause a purge (like another reservation)
            const reservation2 = await ewma.reserve(tokenAddress, 10_000_000n, 1n);
            Assert.expect(reservation2.response.error).toBeUndefined();

            // Check that provider’s liquidity is fully restored
            const reserve = await ewma.getReserve(tokenAddress);
            Assert.expect(reserve.liquidity).toEqual(amountIn); // Should be equal because expired reservations restore liquidity
        });

        // Test 17: Partial swap after reservation from priority provider
        await vm.it(
            'should correctly handle partial swap from priority provider after reservation',
            async () => {
                await ewma.resetStates();
                const p0 = Blockchain.expandToDecimal(100_000, 8);
                await setQuote(p0);

                // Setup two providers, one priority, one normal
                const providerPriority = Blockchain.generateRandomAddress();
                const providerNormal = Blockchain.generateRandomAddress();
                const amt = Blockchain.expandTo18Decimals(10_000);

                // ProviderPriority
                Blockchain.msgSender = providerPriority;
                Blockchain.txOrigin = providerPriority;
                await token.mintRaw(providerPriority, amt);
                await token.approve(providerPriority, ewma.address, amt);
                await ewma.addLiquidity(
                    tokenAddress,
                    providerPriority.p2tr(Blockchain.network),
                    amt,
                    true,
                );

                // ProviderNormal
                Blockchain.msgSender = providerNormal;
                Blockchain.txOrigin = providerNormal;
                await token.mintRaw(providerNormal, amt);
                await token.approve(providerNormal, ewma.address, amt);
                await ewma.addLiquidity(
                    tokenAddress,
                    providerNormal.p2tr(Blockchain.network),
                    amt,
                    false,
                );

                // Buyer reserves liquidity
                const buyer = Blockchain.generateRandomAddress();
                Blockchain.msgSender = buyer;
                Blockchain.txOrigin = buyer;

                const satIn = 500_000_000_000n; // enough satoshis
                const minOut = 1n;
                const reservationResponse = await ewma.reserve(tokenAddress, satIn, minOut);
                Assert.expect(reservationResponse.response.error).toBeUndefined();
                const decodedReservation = ewma.decodeReservationEvents(
                    reservationResponse.response.events,
                );

                const satSent = 330n;
                for (let i = 0; i < decodedReservation.recipients.length; i++) {
                    // overwrite.
                    decodedReservation.recipients[i].amount = satSent;
                }

                createRecipientUTXOs(decodedReservation.recipients); // Mock sending BTC to the provider addresses

                Blockchain.blockNumber++;

                // Partial swap execution
                // The user now swaps with a smaller amount of BTC than reserved to priority provider,
                // resulting in partial fulfillment. Let's assume the contract logic handles partial swaps.
                // For simplicity, just execute swap and ensure it doesn't revert.
                const swapped = await ewma.swap(tokenAddress, false);
                const swapEvent = EWMA.decodeSwapExecutedEvent(
                    swapped.response.events[swapped.response.events.length - 1].data,
                );

                // Check final liquidity
                // After a partial swap, priority provider's liquidity should be reduced by tokens acquired by the buyer.
                // We won't compute exact values here but ensure it's less than initial total.
                const finalReserve = await ewma.getReserve(tokenAddress);
                Assert.expect(finalReserve.liquidity).toBeGreaterThan(0n);
                Assert.expect(finalReserve.liquidity).toBeLessThan(2n * amt); // since some liquidity was swapped out

                // Check swap event
                const l = BigInt(decodedReservation.recipients.length);
                Assert.expect(swapEvent.amountIn).toEqual(satSent * l);
                Assert.expect(swapEvent.amountOut).toEqual(p0 * l * satSent);
            },
        );
    },
);
