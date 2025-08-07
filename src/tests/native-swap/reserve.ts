import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    helper_createPool,
    helper_createToken,
    helper_getReserve,
    helper_listLiquidity,
    helper_reserve,
} from '../utils/OperationHelper.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { IReservationPurgedEvent } from '../../contracts/NativeSwapTypes.js';

await opnet('Native Swap - Reserve', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    const liquidityOwner: Address = Blockchain.generateRandomAddress();
    const floorPrice: bigint = 100000000000000n;
    const initialLiquidityAmount: number = 1_000_000;
    const initialLiquidityAmountExpanded: bigint =
        Blockchain.expandTo18Decimals(initialLiquidityAmount);
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    let tokenAddress: Address;

    async function flushAndReCreatePool(
        maxReserve: number,
        antiBotEnabledFor: number = 0,
        antiBotMaximumTokensPerReservation: bigint = 0n,
    ): Promise<void> {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();

        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(liquidityOwner, 18, 10_000_000);
        tokenAddress = token.address;

        await token.mint(userAddress, 10_000_000);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await helper_createPool(
            nativeSwap,
            token,
            liquidityOwner,
            liquidityOwner,
            initialLiquidityAmount,
            floorPrice,
            initialLiquidityAmountExpanded,
            maxReserve,
            false,
            true,
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
    }

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(liquidityOwner, 18, 10_000_000);
        tokenAddress = token.address;

        await token.mint(userAddress, 10_000_000);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await helper_createPool(
            nativeSwap,
            token,
            liquidityOwner,
            liquidityOwner,
            initialLiquidityAmount,
            floorPrice,
            initialLiquidityAmountExpanded,
            100,
            false,
            true,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to reserve if invalid token address', async () => {
        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                new Address(),
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`Invalid token address`);

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                Blockchain.DEAD_ADDRESS,
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`Invalid token address`);
    });

    await vm.it('should fail to reserve when no pool created', async () => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                Blockchain.generateRandomAddress(),
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`Pool does not exist for token.`);
    });

    await vm.it('should fail to reserve when maximum amount is 0', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                0n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: Maximum amount in cannot be zero.`);
    });

    await vm.it('should fail to reserve our own liquidity', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                liquidityOwner,
                100000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: You cannot reserve your own liquidity.`);
    });

    await vm.it('should fail to reserve when activation delay is invalid', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                10,
            );
        }).toThrow(`NATIVE_SWAP: Activation delay cannot be greater than`);
    });

    await vm.it('should fail to reserve when insufficient fees collected', async () => {
        Blockchain.blockNumber = 1000n;

        await nativeSwap.setFees({
            reservationBaseFee: 20000n,
            priorityQueueBaseFee: 20000n,
        });

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(`NATIVE_SWAP: Insufficient fees collected.`);
    });

    await vm.it('should fail to reserve when user is timed out', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber++;

        for (let i = 0; i < 6; i++) {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
            Blockchain.blockNumber++;
        }

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(`NATIVE_SWAP: User is timed out.`);
    });

    await vm.it('should fail to reserve when reservation has not been purged', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber += 8n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(
            `NATIVE_SWAP: You may not reserve at this time. Your previous reservation has not been purged yet. Please try again later.`,
        );
    });

    await vm.it('should fail to reserve when already an active reservation', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber += 2n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
        }).toThrow(
            `NATIVE_SWAP: You already have an active reservation. Swap or wait for expiration before creating another`,
        );
    });

    await vm.it('should fail to reserve when not enough liquidity available', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            for (let i = 0; i < 61; i++) {
                await helper_reserve(
                    nativeSwap,
                    tokenAddress,
                    Blockchain.generateRandomAddress(),
                    100000000n,
                    0n,
                    false,
                    false,
                    false,
                    2,
                );
            }
        }).toThrow('NATIVE_SWAP: Minimum liquidity not met. satoshis:');
    });

    await vm.it('should fail to reserve when minimum amount not met', async () => {
        Blockchain.blockNumber = 1000n;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                10000n,
                999999999999999999999999999999999n,
                false,
                false,
                false,
                2,
            );
        }).toThrow('NATIVE_SWAP: Not enough liquidity reserved;');
    });

    await vm.it(
        'should fail to reserve when minimum reservation threshold is not met',
        async () => {
            Blockchain.blockNumber = 1000n;

            await flushAndReCreatePool(5);

            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                499985000n,
                1n,
                false,
                false,
                false,
                2,
            );
            await Assert.expect(async () => {
                await helper_reserve(
                    nativeSwap,
                    tokenAddress,
                    Blockchain.generateRandomAddress(),
                    14100n,
                    1n,
                    false,
                    false,
                    false,
                    2,
                );
            }).toThrow('NATIVE_SWAP: Minimum liquidity not met. satoshis');
        },
    );

    await vm.it(
        'should fail to reserve when antibot is active and maximum tokens is exceeded',
        async () => {
            Blockchain.blockNumber = 1000n;

            await flushAndReCreatePool(5, 5, 20000n);

            await Assert.expect(async () => {
                await helper_reserve(
                    nativeSwap,
                    tokenAddress,
                    Blockchain.generateRandomAddress(),
                    10000n,
                    1n,
                    false,
                    false,
                    false,
                    2,
                );
            }).toThrow('NATIVE_SWAP: Cannot exceed anti-bot max tokens per reservation.');
        },
    );

    await vm.it(
        'should allow to reserve when antibot is active and maximum tokens is not exceeded',
        async () => {
            Blockchain.blockNumber = 1000n;

            await flushAndReCreatePool(5, 5, 1100000000000000000000n);

            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                10000n,
                1n,
                false,
                false,
                false,
                2,
            );
        },
    );

    await vm.it(
        'should allow to reserve when antibot is set and maximum tokens is exceeded but block number > antibot expiration block',
        async () => {
            Blockchain.blockNumber = 1000n;

            await flushAndReCreatePool(5, 5, 20000n);

            Blockchain.blockNumber = 1010n;
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                10000n,
                1n,
                false,
                false,
                false,
                2,
            );
        },
    );

    await vm.it(
        'should allow to reserve after maximum reservation limit reached but 6 blocks passed since last reserve',
        async () => {
            Blockchain.blockNumber = 1000n;

            await flushAndReCreatePool(5);

            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                50000000000n,
                1n,
                false,
                false,
                false,
                2,
            );

            Blockchain.blockNumber += 6n;

            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                10000n,
                1n,
                false,
                false,
                false,
                2,
            );
        },
    );

    await vm.it('should allow a user to reserve again after the timeout period', async () => {
        Blockchain.blockNumber = 1000n;

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber++;

        for (let i = 0; i < 10; i++) {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
            Blockchain.blockNumber++;
        }

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );
    });

    await vm.it('should correctly purge reservations', async () => {
        // Be sure to compile the native-swap contract with this flag sets or the test will fail.
        // EMIT_PURGE_EVENTS = true;

        Blockchain.blockNumber = 1000n;

        const user2Address = Blockchain.generateRandomAddress();

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        await helper_reserve(
            nativeSwap,
            tokenAddress,
            user2Address,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber++;

        for (let i = 0; i < 11; i++) {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                Blockchain.generateRandomAddress(),
                100000n,
                0n,
                false,
                false,
                false,
                2,
            );
            Blockchain.blockNumber++;
        }

        const result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            Blockchain.generateRandomAddress(),
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        const reservationPurgedEvents = result.response.events.filter(
            (e) => e.type === 'ReservationPurged',
        );
        const block1000ReservationPurgedEvents: IReservationPurgedEvent[] = [];

        for (let i = 0; i < reservationPurgedEvents.length; i++) {
            const evt = NativeSwapTypesCoders.decodeReservationPurgedEvent(
                reservationPurgedEvents[i].data,
            );

            if (evt.purgingBlock === 1000n) {
                block1000ReservationPurgedEvents.push(evt);
            }
        }

        Assert.expect(block1000ReservationPurgedEvents.length).toEqual(2);
    });

    await vm.it('should allow a user to reserve and emit events', async () => {
        Blockchain.blockNumber = 1000n;

        const result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Assert.expect(result.expectedAmountOut).toEqual(16931470000000000000n);
        Assert.expect(result.totalSatoshis).toEqual(100000n);

        const reservationCreatedEvent = result.response.events.filter(
            (e) => e.type === 'ReservationCreated',
        );

        const liquidityReservedEvent = result.response.events.filter(
            (e) => e.type === 'LiquidityReserved',
        );

        Assert.expect(reservationCreatedEvent.length).toEqual(1);
        Assert.expect(liquidityReservedEvent.length).toEqual(1);
    });

    await vm.it('should allow a user to reserve and send fees to correct address', async () => {
        const feesAddress = Blockchain.generateRandomAddress().p2tr(Blockchain.network);

        Blockchain.blockNumber = 999n;
        await nativeSwap.setFeesAddress({ feesAddress: feesAddress });

        Blockchain.blockNumber = 1000n;

        const result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            userAddress,
            100000n,
            0n,
            false,
            false,
            false,
            2,
            feesAddress,
        );

        Assert.expect(result.expectedAmountOut).toEqual(16931470000000000000n);
        Assert.expect(result.totalSatoshis).toEqual(100000n);

        const reservationCreatedEvent = result.response.events.filter(
            (e) => e.type === 'ReservationCreated',
        );

        const liquidityReservedEvent = result.response.events.filter(
            (e) => e.type === 'LiquidityReserved',
        );

        Assert.expect(reservationCreatedEvent.length).toEqual(1);
        Assert.expect(liquidityReservedEvent.length).toEqual(1);
    });

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
        await token.increaseAllowance(provider1, nativeSwap.address, amt);

        await helper_listLiquidity(
            nativeSwap,
            tokenAddress,
            provider1,
            amt,
            true,
            provider1,
            false,
            false,
        );

        // Provider2: normal queue
        Blockchain.msgSender = provider2;
        Blockchain.txOrigin = provider2;
        await token.increaseAllowance(provider2, nativeSwap.address, amt);

        await helper_listLiquidity(
            nativeSwap,
            tokenAddress,
            provider2,
            amt,
            false,
            provider2,
            false,
            false,
        );

        // Buyer: tries to reserve
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const reservationResponse = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
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

    await vm.it('should restore liquidity after reservation expiration', async () => {
        // Setup a provider and make a reservation that won't be completed
        const amountIn = Blockchain.expandTo18Decimals(50000);
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.increaseAllowance(provider, nativeSwap.address, amountIn);

        await helper_listLiquidity(
            nativeSwap,
            tokenAddress,
            provider,
            amountIn,
            false,
            provider,
            false,
            false,
        );

        // Make a reservation
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;
        const satIn = 20_000_000n;
        const minOut = 1n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
        });

        Assert.expect(reservation.response.error).toBeUndefined();

        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;

        // Fast forward past reservation expiration
        const buyer2 = Blockchain.generateRandomAddress();
        Blockchain.blockNumber = Blockchain.blockNumber + 10n; // > 5 blocks
        Blockchain.msgSender = buyer2;
        Blockchain.txOrigin = buyer2;

        // Trigger purging by a new reservation
        const reservation2 = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: 10_000_000n,
            minimumAmountOut: minOut,
        });

        Assert.expect(reservation2.response.error).toBeUndefined();

        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        // Check that provider’s liquidity is fully restored
        const providerDetails = await nativeSwap.getProviderDetails({
            token: tokenAddress,
        });

        // First reservation has been purged, so only the second reservation should be reserved
        Assert.expect(providerDetails.reserved).toEqual(reservation2.expectedAmountOut);
    });
});
