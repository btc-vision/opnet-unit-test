import { Assert, Blockchain, opnet } from '@btc-vision/unit-test-framework';
import { Address } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../contracts/ewma/NativeSwapTypesCoders.js';
import { NativeSwapTestHelper } from './CommonTestMethods.js';

await opnet('Native Swap - Reservation Process', async (vm) => {
    const testHelper = new NativeSwapTestHelper(vm);

    testHelper.init();
    testHelper.afterEach();

    const TIMEOUT_ENABLED: boolean = false;

    await vm.it('should allow a basic reservation with valid inputs', async () => {
        // We'll do a small second user
        const newUser = Blockchain.generateRandomAddress();

        // Transfer some tokens to newUser so they can list (and thus become providers)
        Blockchain.txOrigin = testHelper.userAddress;
        Blockchain.msgSender = testHelper.userAddress;

        const tokensToList = testHelper.tokenAmountFor10kSat;
        await testHelper.token.transfer(testHelper.userAddress, newUser, tokensToList);

        // Approve NativeSwap so newUser can list liquidity
        await testHelper.token.approve(newUser, testHelper.nativeSwap.address, tokensToList);

        // Now list liquidity from newUser
        Blockchain.txOrigin = newUser;
        Blockchain.msgSender = newUser;

        await testHelper.nativeSwap.listLiquidity({
            token: testHelper.tokenAddress,
            receiver: newUser.p2tr(Blockchain.network),
            amountIn: tokensToList,
            priority: false,
            disablePriorityQueueFees: true,
        });

        // Next, create a reservation from a separate random address
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = buyer;
        Blockchain.msgSender = buyer;

        // This should succeed with the default min trade size = 10_000 sat
        // We'll pass 1 BTC in sat (100_000_000n).
        // minimumAmountOut = 0 => we accept whatever the contract can fill
        const r = await testHelper.nativeSwap.reserve({
            token: testHelper.tokenAddress,
            maximumAmountIn: 100_000_000n,
            minimumAmountOut: 0n,
            forLP: false,
        });

        // Confirm the contract call was successful
        Assert.equal(
            r.expectedAmountOut,
            21002666666666645664000n,
            'Expected expectedAmountOut to be 21002666666666645664000n',
        );

        Assert.equal(r.totalSatoshis, 31504000n, 'Expected totalSatoshis to be 31504000n');

        // Decode reservation events for further checks
        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        // tokensReserved should be > 0
        Assert.toBeGreaterThan(decoded.reservation?.expectedAmountOut || 0n, 0n);
    });

    await vm.it('should revert if token address is invalid', async () => {
        const deadTokenAddr = Address.dead();
        const user = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = user;
        Blockchain.msgSender = user;

        await Assert.throwsAsync(async () => {
            await testHelper.nativeSwap.reserve({
                token: deadTokenAddr, // invalid token
                maximumAmountIn: 200_000_000n,
                minimumAmountOut: 0n,
                forLP: false,
            });
        }, /Invalid token address/i);
    });

    await vm.it('should revert if maximumAmountIn = 0', async () => {
        const user = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = user;
        Blockchain.msgSender = user;

        await Assert.throwsAsync(async () => {
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 0n,
                minimumAmountOut: testHelper.scaleToken(10n),
                forLP: false,
            });
        }, /Maximum amount in cannot be zero/i);
    });

    await vm.it('should revert if maximumAmountIn is below the minimum trade size', async () => {
        // e.g. user tries to buy with 5_000 sat but the min is 10_000
        const user = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = user;
        Blockchain.msgSender = user;

        await Assert.throwsAsync(async () => {
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 5000n,
                minimumAmountOut: 0n,
                forLP: false,
            });
        }, /Requested amount is below minimum trade size/i);
    });

    await vm.it('should revert if insufficient fees have been collected', async () => {
        // Force FeeManager to require a large reservation base fee
        Blockchain.txOrigin = testHelper.userAddress;
        Blockchain.msgSender = testHelper.userAddress;

        // Adjust the fees
        await testHelper.nativeSwap.setFees({
            reservationBaseFee: 50_000n, // 500k sats
            priorityQueueBaseFee: 10n,
            pricePerUserInPriorityQueueBTC: 10n,
        });

        // Next, attempt a reservation from a random user.
        const user = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = user;
        Blockchain.msgSender = user;

        // Because testHelper/nativeSwap automatically tries to create a fee output for reservationFees,
        // but we forced the contract to require 500_000 sats, the "reservationFees" is presumably 10_000n or 50_000n.
        // That won't meet the 500_000n requirement => revert.
        await Assert.throwsAsync(async () => {
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 200_000_000n,
                minimumAmountOut: testHelper.scaleToken(1000n),
                forLP: false,
            });
        }, /Insufficient fees collected/i);

        // (Cleanup, revert fees for subsequent tests.)
        Blockchain.txOrigin = testHelper.userAddress;
        Blockchain.msgSender = testHelper.userAddress;
        await testHelper.nativeSwap.setFees({
            reservationBaseFee: 10_000n, // revert back
            priorityQueueBaseFee: 50_000n,
            pricePerUserInPriorityQueueBTC: 100n,
        });
    });

    await vm.it(
        'should revert if user tries to create a second reservation while one is active',
        async () => {
            const user = Blockchain.generateRandomAddress();

            // 1st reservation
            Blockchain.txOrigin = user;
            Blockchain.msgSender = user;
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 200_000_000n,
                minimumAmountOut: testHelper.scaleToken(1000n),
                forLP: false,
            });

            // 2nd reservation should fail
            await Assert.throwsAsync(async () => {
                await testHelper.nativeSwap.reserve({
                    token: testHelper.tokenAddress,
                    maximumAmountIn: 300_000_000n,
                    minimumAmountOut: testHelper.scaleToken(1000n),
                    forLP: false,
                });
            }, /You already have an active reservation/i);
        },
    );

    if (TIMEOUT_ENABLED) {
        await vm.it('should revert if user is timed out for new reservations', async () => {
            // We simulate a previously expired reservation that sets a user timeout
            const user = Blockchain.generateRandomAddress();

            Blockchain.txOrigin = user;
            Blockchain.msgSender = user;
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 200_000_000n,
                minimumAmountOut: testHelper.scaleToken(1000n),
                forLP: false,
            });

            // Move blocks so reservation is old
            Blockchain.blockNumber = Blockchain.blockNumber + 10n;

            // The contract will purge old reservations (the code automatically triggers purge if purgeOldReservations = true in constructor).
            // Next reservation => user timed out => revert
            await Assert.throwsAsync(async () => {
                await testHelper.nativeSwap.reserve({
                    token: testHelper.tokenAddress,
                    maximumAmountIn: 300_000_000n,
                    minimumAmountOut: testHelper.scaleToken(1000n),
                    forLP: false,
                });
            }, /User is timed out/i);
        });
    }

    await vm.it('should revert if tokensReserved < minimumAmountOut', async () => {
        // We set up a scenario with limited liquidity
        const user = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = user;
        Blockchain.msgSender = user;

        // We request a huge min out => expect revert
        await Assert.throwsAsync(async () => {
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 100_000_000n,
                minimumAmountOut: 999_999_999_999_999_999_999_999_999n, // huge min
                forLP: false,
            });
        }, /Not enough liquidity reserved/i);
    });

    await vm.it('should allow partial reservations across multiple providers', async () => {
        // We'll add multiple providers with small amounts each.
        const providerA = Blockchain.generateRandomAddress();
        const providerB = Blockchain.generateRandomAddress();
        const providerC = Blockchain.generateRandomAddress();

        // Everyone must get tokens from the main user, then list
        await testHelper.listTokenRandom(testHelper.scaleToken(50n), providerA);
        await testHelper.listTokenRandom(testHelper.scaleToken(100n), providerB);
        await testHelper.listTokenRandom(testHelper.scaleToken(75n), providerC);

        // Then the user tries a big reservation
        const user = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = user;
        Blockchain.msgSender = user;

        const res = await testHelper.nativeSwap.reserve({
            token: testHelper.tokenAddress,
            maximumAmountIn: 100_000_000n, // 1 BTC
            minimumAmountOut: testHelper.scaleToken(10n), // just ask for 10 tokens min
            forLP: false,
        });

        // That should partially fill from providers A, B, C in normal queue order.
        Assert.equal(!!res.response.error, false, 'Expected no revert');
        vm.log('Reservation partial fill success, events =>');
        const decoded = NativeSwapTypesCoders.decodeReservationEvents(res.response.events);

        // TODO: Verify events data returned.

        // We expect some tokens to be reserved from each provider.
        // totalSatoshis > 0, expectedAmountOut (the reservationCreatedEvent) > 0
        Assert.toBeGreaterThan(decoded.totalSatoshis, 0n);
        Assert.toBeGreaterThanOrEqual(
            decoded.reservation?.expectedAmountOut || 0n,
            testHelper.scaleToken(10n),
        );
    });

    await vm.it(
        'should revert if final tokensRemaining or cost is below strict dust thresholds',
        async () => {
            await testHelper.randomReserve(100_000_000_000_000_000_000n, 0n);

            await Assert.throwsAsync(async () => {
                await testHelper.randomReserve(100_000_000n, testHelper.scaleToken(0n));
            }, /Minimum liquidity not met/i);
        },
    );

    await vm.it(
        'should purge old reservations and restore any leftover liquidity to providers',
        async () => {
            const p = Blockchain.generateRandomAddress();
            await testHelper.listTokenRandom(
                testHelper.tokenAmountFor10kSat + testHelper.scaleToken(1n),
                p,
            );

            const reserveBefore = await testHelper.nativeSwap.getReserve({
                token: testHelper.tokenAddress,
            });

            Assert.expect(reserveBefore.reservedLiquidity).toEqual(0n);

            const reserved = await testHelper.randomReserve(
                10_000n,
                testHelper.tokenAmountFor10kSat,
            );

            Assert.expect(reserved.expectedAmountOut).toEqual(testHelper.tokenAmountFor10kSat);

            Blockchain.blockNumber = Blockchain.blockNumber + 6n; // > 5 blocks from default

            const reserveAfter = await testHelper.nativeSwap.getReserve({
                token: testHelper.tokenAddress,
            });

            Assert.expect(reserveAfter.liquidity).toEqual(reserveBefore.liquidity);
            Assert.expect(reserveAfter.reservedLiquidity).toEqual(0n);

            Assert.expect(reserveAfter.virtualBTCReserve).toEqual(reserveBefore.virtualBTCReserve);
            Assert.expect(reserveAfter.virtualTokenReserve).toEqual(
                reserveBefore.virtualTokenReserve,
            );

            // The next call on the contract will cause an internal purge
            //    leftover tokens from that reservation should be restored to providers
            // We'll do a new reservation from a new user => triggers purge
            const r2 = await testHelper.randomReserve(200_000_000n, 0n);
            console.log(r2.response.events);

            // Confirm the new reservation succeeded
            // TODO: Verify the events for the new reservation
        },
    );

    await vm.it('should allow forLP reservations and not revert', async () => {
        // The user who will become an LP
        const newLpUser = Blockchain.generateRandomAddress();

        // Transfer them tokens so they can deposit into the pool
        Blockchain.txOrigin = testHelper.userAddress;
        Blockchain.msgSender = testHelper.userAddress;
        const depositAmount = 10_000n;
        await testHelper.token.transfer(testHelper.userAddress, newLpUser, depositAmount);

        // Approve from newLpUser side
        Blockchain.txOrigin = newLpUser;
        Blockchain.msgSender = newLpUser;
        await testHelper.token.approve(newLpUser, testHelper.nativeSwap.address, depositAmount);

        // Reserve with forLP
        const r = await testHelper.nativeSwap.reserve({
            token: testHelper.tokenAddress,
            maximumAmountIn: 200_000_000n,
            minimumAmountOut: testHelper.scaleToken(5000n), // ask for 5_000 tokens min
            forLP: true,
        });

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        Assert.toBeGreaterThan(decoded.reservation?.expectedAmountOut || 0n, 4_999n);

        // TODO: Verify in detail the events data
    });
});
