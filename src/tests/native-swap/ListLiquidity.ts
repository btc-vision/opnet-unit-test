import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';
import { gas2BTC, gas2Sat, gas2USD } from '../utils/TransactionUtils.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';
import { NativeSwapTypesCoders } from '../../contracts/ewma/NativeSwapTypesCoders.js';
import { ListLiquidityResult } from '../../contracts/ewma/NativeSwapTypes.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('NativeSwap: Priority and Normal Queue listLiquidity', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityOwner: Address = Blockchain.generateRandomAddress();
    const initialLiquidityAddress: string = liquidityOwner.p2tr(Blockchain.network);
    const initialLiquidityAmount: bigint = Blockchain.expandTo18Decimals(1_000_000);

    async function mintAndApprove(amount: bigint, to: Address): Promise<void> {
        const addyBefore = Blockchain.msgSender;

        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await token.mintRaw(to, amount);

        Blockchain.txOrigin = addyBefore;
        Blockchain.msgSender = addyBefore;

        await token.approve(addyBefore, nativeSwap.address, amount);
    }

    /**
     * Creates a pool by:
     *  1) Minting the initialLiquidity amount of tokens to userAddress
     *  2) Approving that amount for EWMA contract
     *  3) Calling nativeSwap.createPool(...)
     *
     * In other words, this replaces the old "setQuote" usage,
     * but now we also deposit 'initialLiquidity' as a direct addition
     * into the EWMA contract, designating userAddress as the initial provider.
     */
    async function createPool(
        floorPrice: bigint,
        initialLiquidity: bigint,
        antiBotEnabledFor: number = 0,
        antiBotMaximumTokensPerReservation: bigint = 0n,
    ): Promise<void> {
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidity, liquidityOwner);

        // Create the pool
        const result = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: initialLiquidityAddress,
            antiBotEnabledFor: antiBotEnabledFor,
            antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        vm.debug(
            `Pool created! Gas cost: ${gas2Sat(result.response.usedGas)} sat (${gas2BTC(
                result.response.usedGas,
            )} BTC, $${gas2USD(result.response.usedGas)})`,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    }

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP_20({
            file: 'MyToken',
            deployer: liquidityOwner,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        // Give user some extra tokens beyond the initial liquidity
        // so that subsequent "addLiquidity(...)" calls can work
        // (depending on your test logic).
        await token.mint(userAddress, 10_000_000);

        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        // Create a pool with floorPrice = 1 sat per token and
        // initialLiquidity = 10,000 tokens (arbitrary example).
        // Adjust as needed:
        await createPool(1000n, initialLiquidityAmount);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    // Test 1: Add liquidity to normal queue
    await vm.it('should add liquidity to the normal queue successfully', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);
        await token.approve(userAddress, nativeSwap.address, amountIn);

        const initialUserBalance = await token.balanceOf(userAddress);
        const initialContractBalance = await token.balanceOf(nativeSwap.address);

        const resp: ListLiquidityResult = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: userAddress.p2tr(Blockchain.network),
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
        });

        Assert.expect(resp.response.error).toBeUndefined();
        const finalUserBalance = await token.balanceOf(userAddress);
        const finalContractBalance = await token.balanceOf(nativeSwap.address);

        // Confirm tokens moved
        Assert.expect(finalUserBalance).toEqual(initialUserBalance - amountIn);
        Assert.expect(finalContractBalance).toEqual(initialContractBalance + amountIn);

        // Check events
        const events = resp.response.events;
        const LiquidityListedEvt = events.find((e) => e.type === 'LiquidityListed');
        if (!LiquidityListedEvt) {
            throw new Error('No LiquidityListed event found for normal queue');
        }

        const decoded = NativeSwapTypesCoders.decodeLiquidityListedEvent(LiquidityListedEvt.data);
        Assert.expect(decoded.totalLiquidity).toEqual(amountIn);
        Assert.expect(decoded.provider).toEqual(userAddress.p2tr(Blockchain.network));
    });

    // Test 2: Add liquidity to priority queue
    await vm.it(
        'should add liquidity to the priority queue successfully and apply fee',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.approve(userAddress, nativeSwap.address, amountIn);

            const initialUserBalance = await token.balanceOf(userAddress);
            const initialContractBalance = await token.balanceOf(nativeSwap.address);
            const initialDeadBalance = await token.balanceOf(Address.dead());

            // Priority mode: 3% fee to dead address by default logic
            const resp = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            Assert.expect(resp.response.error).toBeUndefined();

            const feeAmount = (amountIn * 3n) / 100n;
            const finalUserBalance = await token.balanceOf(userAddress);
            const finalContractBalance = await token.balanceOf(nativeSwap.address);
            const finalDeadBalance = await token.balanceOf(Address.dead());

            Assert.expect(finalDeadBalance - initialDeadBalance).toEqual(feeAmount);
            Assert.expect(finalContractBalance - initialContractBalance).toEqual(
                amountIn - feeAmount,
            );
            Assert.expect(initialUserBalance - finalUserBalance).toEqual(amountIn);

            const events = resp.response.events;
            const LiquidityListedEvt = events.find((e) => e.type === 'LiquidityListed');
            if (!LiquidityListedEvt) {
                throw new Error('No LiquidityListed event found for priority queue');
            }

            const decoded = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                LiquidityListedEvt.data,
            );
            Assert.expect(decoded.totalLiquidity).toEqual(amountIn - feeAmount);
        },
    );

    // Test 3: Attempt adding liquidity to priority queue multiple times
    await vm.it(
        'should allow multiple additions to priority queue for the same provider',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(500);
            await token.approve(userAddress, nativeSwap.address, amountIn * 2n);

            // First addition
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            // Second addition
            const resp = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            Assert.expect(resp.response.error).toBeUndefined();

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            // Check total liquidity (minus fee)
            const feeForEach = (amountIn * 3n) / 100n;
            const totalLiquidityExpected = (amountIn - feeForEach) * 2n + initialLiquidityAmount;

            Assert.expect(reserve.liquidity).toEqual(totalLiquidityExpected);
        },
    );

    // Test 4: Attempt adding liquidity to normal queue after having a priority queue position
    await vm.it(
        'should not allow adding normal queue liquidity if provider is already priority',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(100);
            await token.approve(userAddress, nativeSwap.address, amountIn * 2n);

            // Add to priority first
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            // Try adding to normal queue
            await Assert.expect(async () => {
                await nativeSwap.listLiquidity({
                    token: tokenAddress,
                    receiver: userAddress.p2tr(Blockchain.network),
                    amountIn: amountIn,
                    priority: false,
                    disablePriorityQueueFees: false,
                });
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
            await token.approve(userAddress, nativeSwap.address, amountIn * 2n);

            // Step 1: Add liquidity normally (no tax)
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
            });

            // After this step:
            // Provider liquidity = amountIn

            // Step 2: Add liquidity in priority mode
            const resp = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            Assert.expect(resp.response.error).toBeUndefined();

            // Calculate expected final liquidity
            // tax = 3% of amountIn
            const tax = (amountIn * feeRate) / 100n;

            const finalLiquidity = 2n * amountIn - 2n * tax + initialLiquidityAmount;

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
            Assert.expect(reserve.liquidity).toEqual(finalLiquidity);
        },
    );

    // Test 6: Attempt adding liquidity with zero amount
    await vm.it('should fail adding liquidity with zero amount', async () => {
        await token.approve(userAddress, nativeSwap.address, 0n);
        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: 0n,
                priority: false,
                disablePriorityQueueFees: false,
            });
        }).toThrow('Amount in cannot be zero');
    });

    // Test 7: Attempt adding liquidity with no quote set (i.e., no createPool)
    await vm.it('should fail if no p0 (quote) is set', async () => {
        // Re-init a scenario with no call to createPool()
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

        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();
        Blockchain.msgSender = userAddress;

        const amountIn = Blockchain.expandTo18Decimals(100);
        await token.approve(userAddress, nativeSwap.address, amountIn);

        // No createPool(...) invoked here => p0 = 0
        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
            });
        }).toThrow('NOT_ENOUGH_LIQUIDITY');
    });

    // Test 8: Ensure minimum liquidity in sat terms is enforced
    await vm.it('should fail if liquidity in sat value is too low', async () => {
        // We want a huge floorPrice. So re-init an empty scenario and createPool with large p0
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP_20({
            file: 'MyToken',
            deployer: liquidityOwner,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();
        await token.mint(userAddress, 10_000_000);

        nativeSwap = new NativeSwap(liquidityOwner, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        // createPool with a low floorPrice => p0
        await createPool(
            1n,
            Blockchain.expandTo18Decimals(10_000_000), // initial liquidity
        );

        // With that huge p0, a smaller subsequent addition is worthless in sat terms:
        const smallAmount = 10n;
        await token.approve(userAddress, nativeSwap.address, smallAmount);

        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: smallAmount,
                priority: false,
                disablePriorityQueueFees: false,
            });
        }).toThrow('Liquidity value is too low');
    });

    // Test 9: Attempt changing receiver after liquidity is reserved
    await vm.it('should fail if changing receiver when liquidity is reserved', async () => {
        // Add liquidity once normally
        const amountIn = Blockchain.expandTo18Decimals(1000);
        await token.approve(userAddress, nativeSwap.address, amountIn * 2n);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: userAddress.p2tr(Blockchain.network),
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
        });

        // Simulate a scenario where provider gets reserved
        Blockchain.msgSender = Blockchain.generateRandomAddress();
        await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: 100_000_000_000n,
            minimumAmountOut: 1n,
            forLP: false,
        });

        Blockchain.msgSender = userAddress;
        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: Blockchain.generateRandomAddress().p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
            });
        }).toThrow('Cannot change receiver address');
    });

    // Test 11: Multiple providers adding liquidity to both normal and priority queues
    await vm.it('should handle multiple providers adding liquidity to both queues', async () => {
        const provider1 = Blockchain.generateRandomAddress();
        const provider2 = Blockchain.generateRandomAddress();

        const amt = Blockchain.expandTo18Decimals(1000);
        await token.mintRaw(provider1, amt * 2n);
        await token.mintRaw(provider2, amt * 2n);

        // Provider1: normal queue
        Blockchain.msgSender = provider1;
        Blockchain.txOrigin = provider1;
        await token.approve(provider1, nativeSwap.address, amt);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider1.p2tr(Blockchain.network),
            amountIn: amt,
            priority: false,
            disablePriorityQueueFees: false,
        });

        // Provider2: priority queue
        Blockchain.msgSender = provider2;
        Blockchain.txOrigin = provider2;
        await token.approve(provider2, nativeSwap.address, amt);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider2.p2tr(Blockchain.network),
            amountIn: amt,
            priority: true,
            disablePriorityQueueFees: false,
        });

        // Check total reserve: sum of normal + (amt - fee)
        const feeAmt = (amt * 3n) / 100n;
        const expectedLiquidity = amt + (amt - feeAmt) + initialLiquidityAmount;
        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.liquidity).toEqual(expectedLiquidity);
    });

    // Test 12: Ensure after adding liquidity multiple times, EWMA updates are reflected
    await vm.it(
        'should update EWMA after multiple liquidity additions and not revert',
        async () => {
            // Just do some repeated additions and a swap
            const amt = Blockchain.expandTo18Decimals(5000);
            await token.approve(userAddress, nativeSwap.address, amt);
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amt,
                priority: false,
                disablePriorityQueueFees: false,
            });

            const reservation = await nativeSwap.reserve({
                token: tokenAddress,
                maximumAmountIn: 100_000_000_000n,
                minimumAmountOut: 1n,
                forLP: false,
            });

            const decodedReservation2 = NativeSwapTypesCoders.decodeReservationEvents(
                reservation.response.events,
            );
            createRecipientUTXOs(decodedReservation2.recipients);

            Blockchain.blockNumber = Blockchain.blockNumber + 1n;
            await nativeSwap.swap({
                token: tokenAddress,
            });

            // Advance block
            Blockchain.blockNumber = Blockchain.blockNumber + 10n;

            // Add more liquidity
            await token.approve(userAddress, nativeSwap.address, amt);
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amt,
                priority: true,
                disablePriorityQueueFees: false,
            });

            const finalReserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
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
            await token.approve(userAddress, nativeSwap.address, amt);
            await token.approve(user2, nativeSwap.address, amt);

            // userAddress: add priority
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress.p2tr(Blockchain.network),
                amountIn: amt,
                priority: true,
                disablePriorityQueueFees: false,
            });

            // user2: add normal
            Blockchain.msgSender = user2;
            Blockchain.txOrigin = user2;
            const resp = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: user2.p2tr(Blockchain.network),
                amountIn: amt,
                priority: false,
                disablePriorityQueueFees: false,
            });
            Assert.expect(resp.response.error).toBeUndefined();

            // Confirm both are present
            const feeAmt = (amt * 3n) / 100n;
            const expectedLiquidity = amt - feeAmt + amt + initialLiquidityAmount;
            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
            Assert.expect(reserve.liquidity).toEqual(expectedLiquidity);
        },
    );

    // Test 14: Verify reservation picks from priority provider first
    await vm.it('should reserve liquidity from priority providers first', async () => {
        const provider1 = Blockchain.generateRandomAddress();
        const provider2 = Blockchain.generateRandomAddress();

        const satIn = 100_000_000n; // Enough satoshis
        const minOut = 1n;

        const amt = Blockchain.expandTo18Decimals(1000);
        await token.mintRaw(provider1, amt);
        await token.mintRaw(provider2, amt);

        // Provider1: priority queue
        Blockchain.msgSender = provider1;
        Blockchain.txOrigin = provider1;
        await token.approve(provider1, nativeSwap.address, amt);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider1.p2tr(Blockchain.network),
            amountIn: amt,
            priority: true,
            disablePriorityQueueFees: false,
        });

        // Provider2: normal queue
        Blockchain.msgSender = provider2;
        Blockchain.txOrigin = provider2;
        await token.approve(provider2, nativeSwap.address, amt);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider2.p2tr(Blockchain.network),
            amountIn: amt,
            priority: false,
            disablePriorityQueueFees: false,
        });

        // Buyer: tries to reserve
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const reservationResponse = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
            forLP: false,
        });
        Assert.expect(reservationResponse.response.error).toBeUndefined();
        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            reservationResponse.response.events,
        );

        // The first reserved liquidity should come from the priority provider (provider1)
        const priorityProviderRecipient = decodedReservation.recipients[0];
        if (!priorityProviderRecipient) {
            throw new Error('No recipient found in reservation');
        }

        Assert.expect(priorityProviderRecipient.address).toEqual(
            provider1.p2tr(Blockchain.network),
        );
    });

    // Test 15: After reservation, provider cannot change receiver
    await vm.it('should not prevent changing provider receiver address after swap', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);
        // Setup a single provider with normal liquidity
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn * 2n);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.approve(provider, nativeSwap.address, amountIn * 2n);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
        });

        // Make a reservation from a different user
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const satIn = 100_000_000n;
        const minOut = 1n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
            forLP: false,
        });

        const decodedReservation2 = NativeSwapTypesCoders.decodeReservationEvents(
            reservation.response.events,
        );

        createRecipientUTXOs(decodedReservation2.recipients);
        Blockchain.blockNumber = Blockchain.blockNumber + 1n;

        await nativeSwap.swap({
            token: tokenAddress,
        });

        // Now the provider tries to add more liquidity with a different receiver
        const newReceiver = Blockchain.generateRandomAddress().p2tr(Blockchain.network);
        Blockchain.msgSender = provider;

        // Should NOT revert
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: newReceiver,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
        });
    });

    // Test 16: Reservation expiration restores liquidity
    await vm.it('should restore liquidity after reservation expiration', async () => {
        // Setup a provider and make a reservation that won't be completed
        const amountIn = Blockchain.expandTo18Decimals(500);
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.approve(provider, nativeSwap.address, amountIn);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
        });

        // Make a reservation
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;
        const satIn = 50_000_000n;
        const minOut = 1n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
            forLP: false,
        });

        Assert.expect(reservation.response.error).toBeUndefined();

        // Fast forward past reservation expiration
        Blockchain.blockNumber = Blockchain.blockNumber + 10n; // > 5 blocks

        // Trigger purging by a new reservation
        const reservation2 = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: 10_000_000n,
            minimumAmountOut: minOut,
            forLP: false,
        });

        Assert.expect(reservation2.response.error).toBeUndefined();

        // Check that provider’s liquidity is fully restored
        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.liquidity).toEqual(amountIn + initialLiquidityAmount);
    });

    // Test 17: Partial swap after reservation from priority provider
    await vm.it(
        'should correctly handle partial swap from provider after reservation',
        async () => {
            // Reset states first
            await nativeSwap.resetStates();

            // Now do createPool instead of setQuote
            const p0 = 1n;
            await createPool(
                p0,
                Blockchain.expandTo18Decimals(10_000), // initial liquidity
            );

            // Setup two providers, one priority, one normal
            const providerPriority = Blockchain.generateRandomAddress();
            const providerNormal = Blockchain.generateRandomAddress();
            const amt = Blockchain.expandTo18Decimals(10_000);

            // ProviderPriority
            Blockchain.msgSender = providerPriority;
            Blockchain.txOrigin = providerPriority;
            await token.mintRaw(providerPriority, amt);
            await token.approve(providerPriority, nativeSwap.address, amt);
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: providerPriority.p2tr(Blockchain.network),
                amountIn: amt,
                priority: true,
                disablePriorityQueueFees: false,
            });

            // ProviderNormal
            Blockchain.msgSender = providerNormal;
            Blockchain.txOrigin = providerNormal;
            await token.mintRaw(providerNormal, amt);
            await token.approve(providerNormal, nativeSwap.address, amt);
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: providerNormal.p2tr(Blockchain.network),
                amountIn: amt,
                priority: false,
                disablePriorityQueueFees: false,
            });

            // Buyer reserves liquidity
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;

            const satIn = 500_000_000_000n;
            const minOut = 1n;
            const reservationResponse = await nativeSwap.reserve({
                token: tokenAddress,
                maximumAmountIn: satIn,
                minimumAmountOut: minOut,
                forLP: false,
            });

            Assert.expect(reservationResponse.response.error).toBeUndefined();
            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reservationResponse.response.events,
            );

            // Suppose the buyer only actually sends 330 satoshis to each provider address
            const satSent = 330n;
            for (let i = 0; i < decodedReservation.recipients.length; i++) {
                decodedReservation.recipients[i].amount = satSent;
            }

            createRecipientUTXOs(decodedReservation.recipients);

            Blockchain.blockNumber++;

            // Partial swap execution
            const swapped = await nativeSwap.swap({
                token: tokenAddress,
            });

            const swapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                swapped.response.events[swapped.response.events.length - 1].data,
            );

            // Final liquidity must be > 0 but < sum of both providers’ amounts
            const finalReserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
            Assert.expect(finalReserve.liquidity).toBeGreaterThan(0n);
            Assert.expect(finalReserve.liquidity).toBeLessThan(2n * amt + initialLiquidityAmount);

            // Check swap event
            const l = BigInt(decodedReservation.recipients.length);
            Assert.expect(swapEvent.amountIn).toEqual(satSent * l);
            //Assert.expect(swapEvent.amountOut).toEqual(p0 * l * satSent);

            // Another swap call must fail because the reservation is gone
            await Assert.expect(async () => {
                await nativeSwap.swap({
                    token: tokenAddress,
                });
            }).toThrow('No active reservation for this address');
        },
    );
});
