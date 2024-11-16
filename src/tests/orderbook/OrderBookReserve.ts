import { Address } from '@btc-vision/transaction';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';

const receiver: Address = Blockchain.generateRandomAddress();

function calculateExpectedAmountOut(
    satoshisIn: bigint,
    slippage: number,
    ticksLiquidity: Array<[priceLevel: bigint, availableLiquidity: bigint]>,
    tokenDecimals: number = 18,
    minimumSatForTickReservation: bigint = 10_000n,
    minimumLiquidityForTickReservation: bigint = 1_000_000n,
): bigint {
    const tokenInDecimals = BigInt(10) ** BigInt(tokenDecimals);

    let expectedAmountOut = 0n;
    let remainingSatoshis = satoshisIn;

    // Traverse the ticks in ascending order of price level
    for (const [priceLevel, availableLiquidity] of ticksLiquidity) {
        if (remainingSatoshis < minimumSatForTickReservation) {
            break;
        }

        if (availableLiquidity < minimumLiquidityForTickReservation) {
            continue;
        }

        const price = priceLevel;

        // Calculate the maximum amount of tokens that can be bought at this tick
        const maxAmountPossible = (remainingSatoshis * tokenInDecimals) / price;

        // Determine the actual amount to reserve based on available liquidity
        const amountToReserve =
            maxAmountPossible < availableLiquidity ? maxAmountPossible : availableLiquidity;

        if (amountToReserve === 0n) {
            continue;
        }

        // Calculate the satoshis used to reserve this amount
        const satoshisUsed = (amountToReserve * price) / tokenInDecimals;

        remainingSatoshis -= satoshisUsed;
        expectedAmountOut += amountToReserve;

        if (remainingSatoshis < minimumSatForTickReservation) {
            break;
        }
    }

    // Apply slippage adjustment
    expectedAmountOut = (expectedAmountOut * BigInt(10000 - slippage)) / 10000n;

    return expectedAmountOut;
}

await opnet('OrderBook Contract reserveTicks Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver;

    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    let liquidityAmount: bigint;
    let priceLevels: bigint[];

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the OP_20 token
        token = new OP_20({
            fileName: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        await token.mint(userAddress, 100_000_000);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        Blockchain.register(orderBook);
        await orderBook.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;

        // Add liquidity to the order book to set up the environment
        liquidityAmount = Blockchain.expandTo18Decimals(1000); // 1,000 tokens
        priceLevels = [500n, 1000n, 5000n, 10000n, 50000n]; // Price levels in satoshis per token

        // Approve tokens for adding liquidity
        await token.approve(
            userAddress,
            orderBook.address,
            liquidityAmount * BigInt(priceLevels.length),
        );

        for (const priceLevel of priceLevels) {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                liquidityAmount,
                priceLevel,
            );
        }
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it(
        'should reserve ticks successfully with valid inputs and sufficient liquidity',
        async () => {
            const satoshisIn = 100_000_000n; // 1 BTC
            const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n; // Minimum liquidity per tick
            const slippage = 100; // 1%

            // Prepare ticksLiquidity array
            const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
                priceLevel,
                liquidityAmount,
            ]);

            // Calculate the expected amount out using the helper function
            const expectedAmountOut = calculateExpectedAmountOut(
                satoshisIn,
                slippage,
                ticksLiquidity,
                18, // tokenDecimals
                orderBook.minimumSatForTickReservation,
                orderBook.minimumLiquidityForTickReservation,
            );

            const expectedQuoteResponse = await orderBook.getQuote(
                tokenAddress,
                satoshisIn,
                minimumLiquidityPerTick,
            );
            Assert.expect(expectedQuoteResponse.response.error).toBeUndefined();
            const expectedQuote = expectedQuoteResponse.result.expectedAmountOut;

            const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            Assert.expect(callResponse.error).toBeUndefined();

            // Process events individually
            const events = callResponse.events;
            if (events.length < 2) {
                throw new Error('Expected at least two events');
            }

            // First event should be LiquidityReserved
            const liquidityReservedEvent = events[0];
            Assert.expect(liquidityReservedEvent.type).toEqual('LiquidityReserved');

            const decodedLiquidityReservedEvent = OrderBook.decodeLiquidityReservedEvent(
                liquidityReservedEvent.data,
            );
            Assert.expect(decodedLiquidityReservedEvent.tickId).toBeDefined();
            Assert.expect(decodedLiquidityReservedEvent.level).toBeGreaterThan(0n);
            Assert.expect(decodedLiquidityReservedEvent.amount).toBeGreaterThan(0n);

            let totalReservedFromEvents = decodedLiquidityReservedEvent.amount;

            // If there are multiple LiquidityReserved events, process them
            for (let i = 1; i < events.length - 1; i++) {
                const event = events[i];
                Assert.expect(event.type).toEqual('LiquidityReserved');

                const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);
                Assert.expect(decodedEvent.tickId).toBeDefined();
                Assert.expect(decodedEvent.level).toBeGreaterThan(0n);
                Assert.expect(decodedEvent.amount).toBeGreaterThan(0n);

                totalReservedFromEvents += decodedEvent.amount;
            }

            // Last event should be ReservationCreated
            const lastEvent = events[events.length - 1];
            Assert.expect(lastEvent.type).toEqual('ReservationCreated');

            const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(lastEvent.data);
            Assert.expect(decodedReservationEvent.reservationId).toBeDefined();
            Assert.expect(decodedReservationEvent.expectedAmountOut).toEqual(expectedQuote);
            Assert.expect(decodedReservationEvent.expectedAmountOut).toBeGreaterThanOrEqual(
                expectedAmountOut,
            );
            Assert.expect(decodedReservationEvent.buyer).toEqualAddress(userAddress);

            // Compare the expectedAmountOut with the totalReserved from the events
            Assert.expect(totalReservedFromEvents).toBeGreaterThanOrEqual(expectedAmountOut);

            // Check that the result contains the reservationId
            Assert.expect(reservationId).toEqual(decodedReservationEvent.reservationId);

            vm.success(`Reservation successful with ID: ${reservationId}`);

            vm.success(
                `Expected amount out: ${expectedAmountOut} - Actual reservation amount out: ${decodedReservationEvent.expectedAmountOut} - Gas used: ${callResponse.usedGas}gas`,
            );
        },
    );

    /*await vm.it('should emit correct events when reserving ticks', async () => {
        const satoshisIn = 100_000_000n; // 1 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Prepare ticksLiquidity array
        const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
            priceLevel,
            liquidityAmount,
        ]);

        // Calculate the expected amount out using the helper function
        const expectedAmountOut = calculateExpectedAmountOut(
            satoshisIn,
            slippage,
            ticksLiquidity,
            18, // tokenDecimals
            orderBook.minimumSatForTickReservation,
            orderBook.minimumLiquidityForTickReservation,
        );

        const expectedQuoteResponse = await orderBook.getQuote(
            tokenAddress,
            satoshisIn,
            minimumLiquidityPerTick,
        );
        Assert.expect(expectedQuoteResponse.response.error).toBeUndefined();
        const expectedQuote = expectedQuoteResponse.result.expectedAmountOut;

        const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(callResponse.error).toBeUndefined();

        // Process events individually
        const events = callResponse.events;

        // Check that events are emitted in the correct order
        Assert.expect(events.length).toBeGreaterThan(1);

        // The events should be LiquidityReserved events followed by a ReservationCreated event

        // Process LiquidityReserved events
        let liquidityReservedEventCount = 0;
        let totalReservedFromEvents = 0n;

        for (let i = 0; i < events.length - 1; i++) {
            const event = events[i];
            Assert.expect(event.type).toEqual('LiquidityReserved');

            const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);
            Assert.expect(decodedEvent.tickId).toBeDefined();
            Assert.expect(decodedEvent.level).toBeGreaterThan(0n);
            Assert.expect(decodedEvent.amount).toBeGreaterThan(0n);

            liquidityReservedEventCount++;
            totalReservedFromEvents += decodedEvent.amount;
        }

        // Verify ReservationCreated event
        const reservationEvent = events[events.length - 1];
        Assert.expect(reservationEvent.type).toEqual('ReservationCreated');

        const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(
            reservationEvent.data,
        );

        Assert.expect(decodedReservationEvent.reservationId).toBeDefined();
        Assert.expect(decodedReservationEvent.expectedAmountOut).toEqual(expectedQuote);
        Assert.expect(decodedReservationEvent.buyer).toEqualAddress(userAddress);

        // Compare the expectedAmountOut with the totalReserved from the events
        Assert.expect(decodedReservationEvent.expectedAmountOut).toEqual(expectedAmountOut);
        Assert.expect(totalReservedFromEvents).toEqual(expectedAmountOut);

        // Check that the result contains the reservationId
        Assert.expect(reservationId).toEqual(decodedReservationEvent.reservationId);

        vm.success(`Emitted ${liquidityReservedEventCount} LiquidityReserved events`);
    });

    await vm.it('should fail to reserve ticks with invalid token address', async () => {
        const invalidTokenAddress = Address.dead();
        const satoshisIn = 100_000n; // 0.001 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        await Assert.expect(async () => {
            await orderBook.reserveTicks(
                invalidTokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
        }).toThrow('ORDER_BOOK: Invalid token address');
    });

    await vm.it('should fail to reserve ticks when satoshisIn is zero', async () => {
        const satoshisIn = 0n;
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        await Assert.expect(async () => {
            await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
        }).toThrow('ORDER_BOOK: Maximum amount in cannot be zero');
    });

    await vm.it(
        'should fail to reserve ticks when satoshisIn is below minimum trade size',
        async () => {
            // Assuming minimumTradeSize is 10,000 satoshis as per contract
            const satoshisIn = 9_999n; // Below minimum trade size
            const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            await Assert.expect(async () => {
                await orderBook.reserveTicks(
                    tokenAddress,
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }).toThrow('ORDER_BOOK: Requested amount is below minimum trade size');
        },
    );

    await vm.it('should fail to reserve ticks when minimumAmountOut is zero', async () => {
        const satoshisIn = 100_000n; // 0.001 BTC
        const minimumAmountOut = 0n;
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        await Assert.expect(async () => {
            await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
        }).toThrow('ORDER_BOOK: Minimum amount out cannot be zero');
    });

    await vm.it('should fail to reserve ticks when slippage exceeds 100%', async () => {
        const satoshisIn = 100_000n; // 0.001 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 10001; // 100.01%

        await Assert.expect(async () => {
            await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
        }).toThrow('ORDER_BOOK: Slippage cannot exceed 100%');
    });

    await vm.it(
        'should fail to reserve ticks when buyer already has a pending reservation',
        async () => {
            const satoshisIn = 100_000_000n; // 1 BTC
            const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            // First reservation
            await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            // Attempt to make a second reservation before the first one expires
            await Assert.expect(async () => {
                await orderBook.reserveTicks(
                    tokenAddress,
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }).toThrow('ORDER_BOOK: Reservation already exists or pending');
        },
    );

    await vm.it(
        'should fail to reserve ticks when insufficient liquidity is available',
        async () => {
            const satoshisIn = 1_000_000_000_000n; // Very large amount
            const minimumAmountOut = Blockchain.expandTo18Decimals(1_000_000); // Minimum 1,000,000 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            await Assert.expect(async () => {
                await orderBook.reserveTicks(
                    tokenAddress,
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }).toThrow('ORDER_BOOK: Insufficient liquidity to reserve at requested quote.');
        },
    );

    await vm.it('should reserve ticks correctly and expectedAmountOut should match', async () => {
        const satoshisIn = 100_000_000n; // 1 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        const expectedQuoteResponse = await orderBook.getQuote(
            tokenAddress,
            satoshisIn,
            minimumLiquidityPerTick,
        );
        Assert.expect(expectedQuoteResponse.response.error).toBeUndefined();
        const expectedAmountOut = expectedQuoteResponse.result.expectedAmountOut;

        const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(callResponse.error).toBeUndefined();

        // Decode the ReservationCreatedEvent
        const reservationEvent = callResponse.events.find(
            (event) => event.type === 'ReservationCreated',
        );

        Assert.expect(reservationEvent).toBeDefined();

        if (!reservationEvent) {
            throw new Error('ReservationCreated event not found');
        }

        const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(
            reservationEvent.data,
        );

        Assert.expect(decodedReservationEvent.expectedAmountOut).toBeGreaterThanOrEqual(
            minimumAmountOut,
        );
        Assert.expect(decodedReservationEvent.expectedAmountOut).toEqual(expectedAmountOut);

        vm.success(`Reserved ticks with expected amount out: ${expectedAmountOut}`);
    });

    await vm.it(
        'should handle performance when reserving ticks with many price levels',
        async () => {
            // Add a large number of ticks
            const numberOfTicks = 500;
            const liquidityAmount = Blockchain.expandTo18Decimals(10); // 10 tokens per tick

            // Approve tokens for adding liquidity
            await token.approve(
                userAddress,
                orderBook.address,
                liquidityAmount * BigInt(numberOfTicks),
            );

            const priceLevels: bigint[] = [];
            const tickSpacing = 10n; // Assuming tickSpacing is 10

            for (let i = 0; i < numberOfTicks; i++) {
                const priceLevel = BigInt((i + 1) * Number(tickSpacing));
                priceLevels.push(priceLevel);
                await orderBook.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    liquidityAmount,
                    priceLevel,
                );
            }

            const satoshisIn = 1_000_000_000n; // 10 BTC
            const minimumAmountOut = Blockchain.expandTo18Decimals(100); // Minimum 100 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 500; // 5%

            const startedAt = Date.now();
            const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
            const timeTaken = Date.now() - startedAt;

            Assert.expect(callResponse.error).toBeUndefined();

            vm.success(`Reserve ticks with many price levels completed in ${timeTaken}ms`);
        },
    );

    await vm.it('should handle multiple reservations from different users', async () => {
        const user1 = Blockchain.generateRandomAddress();
        const user2 = Blockchain.generateRandomAddress();
        const satoshisIn = 100_000_000n; // 1 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // First user makes a reservation
        Blockchain.msgSender = user1;
        const { result: reservationId1, response: callResponse1 } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(callResponse1.error).toBeUndefined();

        // Second user makes a reservation
        Blockchain.msgSender = user2;
        const { result: reservationId2, response: callResponse2 } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(callResponse2.error).toBeUndefined();

        vm.success('Multiple reservations from different users succeeded');
    });

    await vm.it(
        'should fail to reserve ticks if the same user tries to reserve for another token without expiring the first reservation',
        async () => {
            const anotherTokenAddress = Blockchain.generateRandomAddress();

            // Instantiate and register another token
            const anotherToken = new OP_20({
                fileName: 'AnotherToken',
                deployer: userAddress,
                address: anotherTokenAddress,
                decimals: 18,
            });

            Blockchain.register(anotherToken);
            await anotherToken.init();

            // Mint tokens to the user
            const mintAmount = 100_000_000;
            await anotherToken.mint(userAddress, mintAmount);

            // Add liquidity to the OrderBook for the new token
            const liquidityAmount = Blockchain.expandTo18Decimals(1000);
            const priceLevel = 5000n;

            // Approve tokens for adding liquidity
            await anotherToken.approve(userAddress, orderBook.address, liquidityAmount);

            await orderBook.addLiquidity(
                anotherTokenAddress,
                userAddress.p2tr(Blockchain.network),
                liquidityAmount,
                priceLevel,
            );

            const satoshisIn = 100_000_000n; // 1 BTC
            const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            // First reservation for the original token
            await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            // Attempt to make a reservation for another token
            await Assert.expect(async () => {
                await orderBook.reserveTicks(
                    anotherTokenAddress,
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }).toThrow('ORDER_BOOK: Reservation already exists or pending');

            anotherToken.dispose();
        },
    );

    await vm.it(
        'should fail to reserve ticks when remainingSatoshis is less than minimumSatForTickReservation',
        async () => {
            const satoshisIn = 10_500n; // Close to minimumSatForTickReservation
            const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            Assert.expect(callResponse.error).toBeUndefined();

            // Decode the ReservationCreatedEvent
            const reservationEvent = callResponse.events.find(
                (event) => event.type === 'ReservationCreated',
            );

            if (!reservationEvent) {
                throw new Error('ReservationCreated event not found');
            }

            Assert.expect(reservationEvent).toBeDefined();

            const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(
                reservationEvent.data,
            );

            Assert.expect(decodedReservationEvent.expectedAmountOut).toBeGreaterThan(0n);

            vm.success('Reservation succeeded even with minimal remaining satoshis');
        },
    );

    await vm.it(
        'should fail to reserve ticks when slippage adjustment results in insufficient liquidity',
        async () => {
            const satoshisIn = 100_000_000n; // 1 BTC
            const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 9999; // 99.99% slippage, effectively requesting minimal tokens

            await Assert.expect(async () => {
                await orderBook.reserveTicks(
                    tokenAddress,
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }).toThrow('ORDER_BOOK: Insufficient liquidity to reserve at requested quote.');
        },
    );*/
});
