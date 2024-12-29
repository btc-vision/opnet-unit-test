import { Address, NetEvent } from '@btc-vision/transaction';
import {
    LiquidityAddedEvent,
    LiquidityReserved,
    OrderBook,
    ReservationCreatedEvent,
} from '../../contracts/order-book/OrderBook.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import {
    calculateExpectedAmountOut,
    createFeeOutput,
    updateReserves,
} from '../../tests/utils/TransactionUtils.js';

const receiver: Address = Blockchain.generateRandomAddress();

function decodeEvents(events: NetEvent[]): Array<unknown> {
    const results: Array<unknown> = [];

    for (const event of events) {
        switch (event.type) {
            case 'LiquidityReserved':
                results.push(OrderBook.decodeLiquidityReservedEvent(event.data));
                break;
            case 'ReservationCreated':
                results.push(OrderBook.decodeReservationCreatedEvent(event.data));
                break;
            case 'TickUpdated':
                results.push(OrderBook.decodeTickUpdatedEvent(event.data));
                break;
            case 'SwapExecuted':
                results.push(OrderBook.decodeSwapExecutedEvent(event.data));
                break;
            default:
                throw new Error(`Unknown event type: ${event.type}`);
        }
    }

    return results;
}

await opnet('OrderBook Contract reserveTicks Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    const user1 = Blockchain.generateRandomAddress();
    const user2 = Blockchain.generateRandomAddress();
    const user3 = Blockchain.generateRandomAddress();

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver;

    const tokenDecimals = 18;
    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const priceLevels: bigint[] = [500n, 1000n, 5000n, 10000n, 50000n];
    const limiter: bigint = 2500n;
    const fee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(priceLevels.length);

    vm.beforeEach(async () => {
        Blockchain.msgSender = receiver;
        Blockchain.blockNumber = 1000n;

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
        await token.mint(userAddress, 100_000_000);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        Blockchain.register(orderBook);
        await orderBook.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;

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

        createFeeOutput(fee);
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it(
        'should reserve ticks successfully with valid inputs and sufficient liquidity (consume 100% of available liquidity)',
        async () => {
            const satoshisIn = 100_000_000n; // 1 BTC
            const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
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
                tokenDecimals,
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
            let totalReservedFromEvents: bigint = 0n;

            // Decode all LiquidityReserved events
            for (let i = 0; i < events.length - 1; i++) {
                const event = events[i];
                Assert.expect(event.type).toEqual('LiquidityReserved');

                const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);

                Assert.expect(decodedEvent.tickId).toBeDefined();
                Assert.expect(decodedEvent.level).toEqual(priceLevels[i]);
                Assert.expect(decodedEvent.amount).toEqual(liquidityAmount);

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

    await vm.it('should fail to reserve ticks with invalid token address', async () => {
        const invalidTokenAddress = Address.dead();
        const satoshisIn = 100_000n; // 0.001 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
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
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
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
            const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
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

    await vm.it(
        'should fail to reserve ticks when minimumAmountOut is zero due to slippage adjustment',
        async () => {
            const satoshisIn = 100_000n; // 0.001 BTC
            const minimumAmountOut = 1n;
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
            }).toThrow('ORDER_BOOK: Minimum amount out with slippage cannot be zero');
        },
    );

    await vm.it('should fail to reserve ticks when slippage exceeds 100%', async () => {
        const satoshisIn = 100_000n; // 0.001 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
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
            const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
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
                Blockchain.blockNumber += 1n;

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
            const minimumAmountOut = Blockchain.expandToDecimal(1_000_000, tokenDecimals); // Minimum 1,000,000 tokens
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
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        const expectedQuoteResponse = await orderBook.getQuote(
            tokenAddress,
            satoshisIn,
            minimumLiquidityPerTick,
        );

        Assert.expect(expectedQuoteResponse.response.error).toBeUndefined();

        const expectedAmountOut = expectedQuoteResponse.result.expectedAmountOut;
        const { response: callResponse } = await orderBook.reserveTicks(
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
        'should reserve ticks when slippage adjustment results in sufficient liquidity',
        async () => {
            const satoshisIn = 50_000_000n; // 1 BTC
            const minimumAmountOut: bigint = liquidityAmount * BigInt(priceLevels.length);
            const minimumLiquidityPerTick = 1n;
            const slippage = 1000; // 10%

            // Prepare ticksLiquidity array
            const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
                priceLevel,
                liquidityAmount,
            ]);

            const result = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            const expectedAmountOut = calculateExpectedAmountOut(
                satoshisIn,
                slippage,
                ticksLiquidity,
                tokenDecimals,
                orderBook.minimumSatForTickReservation,
                orderBook.minimumLiquidityForTickReservation,
            );

            const events = decodeEvents(result.response.events);
            const reservationCreatedEvent = events[events.length - 1] as ReservationCreatedEvent;
            const amountOut: bigint = reservationCreatedEvent.expectedAmountOut;

            Assert.expect(amountOut).toBeGreaterThanOrEqual(expectedAmountOut);
        },
    );

    await vm.it(
        'should fail to reserve ticks when slippage adjustment results in insufficient liquidity',
        async () => {
            const satoshisIn = 50_000_000n; // 1 BTC
            const minimumAmountOut: bigint = liquidityAmount * BigInt(priceLevels.length);
            const minimumLiquidityPerTick = 1n;
            const slippage = 0; // 99.99% slippage, effectively requesting minimal tokens

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

    await vm.it(
        'should reserve ticks when remainingSatoshis is equal to minimumSatForTickReservation',
        async () => {
            const satoshisIn = 510_000n; // Close to minimumSatForTickReservation
            const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 0; // 1%

            const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
                priceLevel,
                liquidityAmount,
            ]);

            const expectedAmountOut = calculateExpectedAmountOut(
                satoshisIn,
                slippage,
                ticksLiquidity,
                tokenDecimals,
                orderBook.minimumSatForTickReservation,
                orderBook.minimumLiquidityForTickReservation,
            );

            const { response: callResponse } = await orderBook.reserveTicks(
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
            Assert.expect(callResponse.events.length).toEqual(3);

            const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(
                reservationEvent.data,
            );

            Assert.expect(decodedReservationEvent.expectedAmountOut).toEqual(expectedAmountOut);

            vm.success('Reservation succeeded even with minimal remaining satoshis');
        },
    );

    await vm.it(
        'should not reserve ticks when remainingSatoshis is less than minimumSatForTickReservation',
        async () => {
            const satoshisIn = 509_999n; // Close to minimumSatForTickReservation
            const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 0; // 1%

            const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
                priceLevel,
                liquidityAmount,
            ]);

            const expectedAmountOut = calculateExpectedAmountOut(
                satoshisIn,
                slippage,
                ticksLiquidity,
                tokenDecimals,
                orderBook.minimumSatForTickReservation,
                orderBook.minimumLiquidityForTickReservation,
            );

            const { response: callResponse } = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            Assert.expect(callResponse.error).toBeUndefined();
            Assert.expect(callResponse.events.length).toEqual(2);

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

            Assert.expect(decodedReservationEvent.expectedAmountOut).toEqual(expectedAmountOut);

            vm.success('Reservation succeeded even with minimal remaining satoshis');
        },
    );

    await vm.it('should be able to consume at least 23 ticks before using 100b gas', async () => {
        // Add a large number of ticks
        const numberOfTicks = 18 - priceLevels.length; //64;
        const liquidityAmount = Blockchain.expandToDecimal(10, tokenDecimals); // 10 tokens per tick

        // Approve tokens for adding liquidity
        await token.approve(
            userAddress,
            orderBook.address,
            liquidityAmount * BigInt(numberOfTicks),
        );

        const tickSpacing = 10n; // Assuming tickSpacing is 10

        // add 65 ticks.
        for (let i = 0; i < numberOfTicks; i++) {
            const priceLevel = BigInt(i * Number(tickSpacing) + 20000);

            const user1 = Blockchain.generateRandomAddress();
            const user2 = Blockchain.generateRandomAddress();
            const user3 = Blockchain.generateRandomAddress();

            await token.transfer(receiver, user1, liquidityAmount);
            await token.transfer(receiver, user2, liquidityAmount);
            await token.transfer(receiver, user3, liquidityAmount);

            Blockchain.txOrigin = user1;
            Blockchain.msgSender = user1;
            await token.approve(
                user1,
                orderBook.address,
                liquidityAmount * BigInt(priceLevels.length),
            );
            await orderBook.addLiquidity(
                tokenAddress,
                user1.p2tr(Blockchain.network),
                liquidityAmount / 3n,
                priceLevel,
            );

            Blockchain.txOrigin = user2;
            Blockchain.msgSender = user2;
            await token.approve(
                user2,
                orderBook.address,
                liquidityAmount * BigInt(priceLevels.length),
            );
            await orderBook.addLiquidity(
                tokenAddress,
                user2.p2tr(Blockchain.network),
                liquidityAmount / 3n,
                priceLevel,
            );

            Blockchain.txOrigin = user3;
            Blockchain.msgSender = user3;
            await token.approve(
                user3,
                orderBook.address,
                liquidityAmount * BigInt(priceLevels.length),
            );
            await orderBook.addLiquidity(
                tokenAddress,
                user3.p2tr(Blockchain.network),
                liquidityAmount / 3n + 10n,
                priceLevel,
            );
        }

        Blockchain.txOrigin = receiver;
        Blockchain.msgSender = receiver;

        /*await orderBook.addLiquidity(
            tokenAddress,
            receiver.p2tr(Blockchain.network),
            10_000_000n,
            1000000000000000000n,
        );*/

        const satoshisIn = 50_000_000_000n; // 10 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(100); // Minimum 100 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 500; // 5%
        const totalTicks = numberOfTicks + priceLevels.length;

        const txFee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(totalTicks);

        createFeeOutput(txFee);

        const startedAt = Date.now();
        const { response: callResponse } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        const events = decodeEvents(callResponse.events);
        Assert.expect(events.length).toBeGreaterThanOrEqual(totalTicks);

        const timeTaken = Date.now() - startedAt;

        Assert.expect(callResponse.error).toBeUndefined();
        Assert.expect(callResponse.usedGas).toBeLessThanOrEqual(100_000_000_000n);

        vm.success(
            `Reserve ticks with many price levels completed in ${timeTaken}ms with ${callResponse.usedGas} gas`,
        );

        await Assert.expect(async () => {
            const c = await orderBook.getQuote(tokenAddress, satoshisIn, minimumLiquidityPerTick);
            console.log(c);
        }).toThrow('Insufficient liquidity to provide a quote');

        Blockchain.blockNumber += 1000n;

        const expectedQuoteResponse = await orderBook.getQuote(
            tokenAddress,
            satoshisIn,
            minimumLiquidityPerTick,
        );

        console.log(expectedQuoteResponse);
    });

    await vm.it(
        'should be able to consume at least 23 ticks before using 100b gas and then swap it.',
        async () => {
            // Add a large number of ticks
            const numberOfTicks = 18 - priceLevels.length;
            const liquidityAmount = Blockchain.expandToDecimal(10, tokenDecimals); // 10 tokens per tick

            // Approve tokens for adding liquidity
            await token.approve(
                userAddress,
                orderBook.address,
                liquidityAmount * BigInt(numberOfTicks),
            );

            const tickSpacing = 10n; // Assuming tickSpacing is 10

            // add 65 ticks.
            for (let i = 0; i < numberOfTicks; i++) {
                const priceLevel = BigInt(i * Number(tickSpacing) + 20000);

                const user1 = Blockchain.generateRandomAddress();
                const user2 = Blockchain.generateRandomAddress();
                const user3 = Blockchain.generateRandomAddress();

                await token.transfer(receiver, user1, liquidityAmount);
                await token.transfer(receiver, user2, liquidityAmount);
                await token.transfer(receiver, user3, liquidityAmount);

                Blockchain.txOrigin = user1;
                Blockchain.msgSender = user1;
                await token.approve(
                    user1,
                    orderBook.address,
                    liquidityAmount * BigInt(priceLevels.length),
                );
                await orderBook.addLiquidity(
                    tokenAddress,
                    user1.p2tr(Blockchain.network),
                    liquidityAmount / 3n,
                    priceLevel,
                );

                Blockchain.txOrigin = user2;
                Blockchain.msgSender = user2;
                await token.approve(
                    user2,
                    orderBook.address,
                    liquidityAmount * BigInt(priceLevels.length),
                );
                await orderBook.addLiquidity(
                    tokenAddress,
                    user2.p2tr(Blockchain.network),
                    liquidityAmount / 3n,
                    priceLevel,
                );

                Blockchain.txOrigin = user3;
                Blockchain.msgSender = user3;
                await token.approve(
                    user3,
                    orderBook.address,
                    liquidityAmount * BigInt(priceLevels.length),
                );
                await orderBook.addLiquidity(
                    tokenAddress,
                    user3.p2tr(Blockchain.network),
                    liquidityAmount / 3n + 10n,
                    priceLevel,
                );
            }

            Blockchain.txOrigin = receiver;
            Blockchain.msgSender = receiver;

            const satoshisIn = 50_000_000_000n; // 10 BTC
            const minimumAmountOut = Blockchain.expandTo18Decimals(100); // Minimum 100 tokens
            const minimumLiquidityPerTick = 1n;
            const slippage = 500; // 5%
            const totalTicks = numberOfTicks + priceLevels.length;

            const txFee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(totalTicks);

            createFeeOutput(txFee);

            const startedAt = Date.now();
            const { response: callResponse } = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            const events: (LiquidityReserved | LiquidityAddedEvent | ReservationCreatedEvent)[] =
                decodeEvents(callResponse.events) as (
                    | LiquidityReserved
                    | LiquidityAddedEvent
                    | ReservationCreatedEvent
                )[];
            Assert.expect(events.length).toBeGreaterThanOrEqual(totalTicks);

            const timeTaken = Date.now() - startedAt;
            Assert.expect(callResponse.error).toBeUndefined();
            Assert.expect(callResponse.usedGas).toBeLessThanOrEqual(100_000_000_000n);

            vm.success(
                `Reserve ticks with many price levels completed in ${timeTaken}ms with ${callResponse.usedGas} gas`,
            );

            Blockchain.blockNumber += 1n;

            // AND SWAP IT.
            const priceLevelsFinal = events
                .map((event: LiquidityReserved | LiquidityAddedEvent | ReservationCreatedEvent) => {
                    if ('level' in event) {
                        return event.level;
                    }
                })
                .filter((level) => level !== undefined);

            console.log('priceLevelsFinal', priceLevelsFinal, events);

            const swap = await orderBook.swap(tokenAddress, false, priceLevelsFinal);
            const gasCostInSat = swap.response.usedGas / 1_000_000n;
            vm.log(
                `Used ${swap.response.usedGas}gas to swap, which is ${gasCostInSat} satoshis - ${Number(gasCostInSat) / 100000000} BTC.`,
            );

            const decodedEventsSwap = decodeEvents(swap.response.events);

            console.log('SWAPPED', swap, decodedEventsSwap);

            /*await Assert.expect(async () => {
                const c = await orderBook.getQuote(
                    tokenAddress,
                    satoshisIn,
                    minimumLiquidityPerTick,
                );
                console.log(c);
            }).toThrow('Insufficient liquidity to provide a quote');

            Blockchain.blockNumber += 1000n;

            const expectedQuoteResponse = await orderBook.getQuote(
                tokenAddress,
                satoshisIn,
                minimumLiquidityPerTick,
            );

            console.log(expectedQuoteResponse);*/
        },
    );

    await vm.it('should only reserve 25% of each tick when the limiter is enabled.', async () => {
        const satoshisIn = 10_000_000_000n; // 1 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n; // Minimum liquidity per tick
        const slippage = 100; // 1%

        // Prepare ticksLiquidity array
        const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
            priceLevel,
            liquidityAmount,
        ]);

        // Calculate the expected amount out using the helper function
        const _expectedAmountOut = calculateExpectedAmountOut(
            satoshisIn,
            slippage,
            ticksLiquidity,
            tokenDecimals,
            orderBook.minimumSatForTickReservation,
            orderBook.minimumLiquidityForTickReservation,
        );

        const expectedAmountOut = (_expectedAmountOut * limiter) / 10000n;

        await orderBook.toggleLimiter(true);

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
        let totalReservedFromEvents: bigint = 0n;

        // Decode all LiquidityReserved events
        for (let i = 0; i < events.length - 1; i++) {
            const event = events[i];
            Assert.expect(event.type).toEqual('LiquidityReserved');

            const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);
            const limitedPrice = (liquidityAmount * limiter) / 10000n;

            Assert.expect(decodedEvent.tickId).toBeDefined();
            Assert.expect(decodedEvent.level).toEqual(priceLevels[i]);
            Assert.expect(decodedEvent.amount).toEqual(limitedPrice);

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
    });

    await vm.it('should handle multiple reservations from different users', async () => {
        const user1 = Blockchain.generateRandomAddress();
        const user2 = Blockchain.generateRandomAddress();
        const satoshisIn = 1_000_000n; // 0.01 BTC
        const minimumAmountOut = Blockchain.expandTo18Decimals(10); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // First user makes a reservation
        Blockchain.msgSender = user1;
        const { response: callResponse1 } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(callResponse1.error).toBeUndefined();

        // Second user makes a reservation
        Blockchain.msgSender = user2;
        const { response: callResponse2 } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(callResponse2.error).toBeUndefined();

        vm.success('Multiple reservations from different users succeeded');
    });

    await vm.it('should handle front-running attempts correctly', async () => {
        const satoshisIn = 50_000_000n; // 0.5 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Both users attempt to reserve ticks in the same block
        Blockchain.msgSender = user1;
        const attackerResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Blockchain.msgSender = user2;
        const victimResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(attackerResponse.response.error).toBeUndefined();
        Assert.expect(victimResponse.response.error).toBeUndefined();

        // Check that both reservations were successful and that the liquidity was allocated correctly
        const attackerEvents = decodeEvents(attackerResponse.response.events);
        const victimEvents = decodeEvents(victimResponse.response.events);

        const attackerReservationEvent = attackerEvents[
            attackerEvents.length - 1
        ] as ReservationCreatedEvent;

        const victimReservationEvent = victimEvents[
            victimEvents.length - 1
        ] as ReservationCreatedEvent;

        Assert.expect(attackerReservationEvent).toBeDefined();
        Assert.expect(victimReservationEvent).toBeDefined();

        // Verify that both reservations have different reservation IDs
        Assert.expect(attackerReservationEvent.reservationId).toNotEqual(
            victimReservationEvent.reservationId,
        );

        // Verify that the total reserved amount does not exceed the available liquidity
        const totalReserved =
            attackerReservationEvent.expectedAmountOut + victimReservationEvent.expectedAmountOut;

        const totalLiquidity = liquidityAmount * BigInt(priceLevels.length);

        Assert.expect(totalReserved).toBeLessThanOrEqual(totalLiquidity);

        vm.success('Front-running attempt handled correctly with both reservations processed.');
    });

    await vm.it('should handle multiple users reserving in the same block', async () => {
        const satoshisIn = 20_000_000n; // 0.2 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(5, tokenDecimals); // Minimum 5 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 0; // 1%

        // All users attempt to reserve ticks in the same block
        Blockchain.msgSender = user1;
        const user1Response = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Blockchain.msgSender = user2;
        const user2Response = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Blockchain.msgSender = user3;
        const user3Response = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(user1Response.response.error).toBeUndefined();
        Assert.expect(user2Response.response.error).toBeUndefined();
        Assert.expect(user3Response.response.error).toBeUndefined();

        // Check that all reservations were successful and that the liquidity was allocated correctly
        const user1Events = decodeEvents(user1Response.response.events);
        const user2Events = decodeEvents(user2Response.response.events);
        const user3Events = decodeEvents(user3Response.response.events);

        const user1ReservationEvent = user1Events[
            user1Events.length - 1
        ] as ReservationCreatedEvent;

        const user2ReservationEvent = user2Events[
            user2Events.length - 1
        ] as ReservationCreatedEvent;

        const user3ReservationEvent = user3Events[
            user3Events.length - 1
        ] as ReservationCreatedEvent;

        Assert.expect(user1ReservationEvent).toBeDefined();
        Assert.expect(user2ReservationEvent).toBeDefined();
        Assert.expect(user3ReservationEvent).toBeDefined();

        // Verify that each user has a unique reservation ID
        Assert.expect(user1ReservationEvent.reservationId).toNotEqual(
            user2ReservationEvent.reservationId,
        );

        Assert.expect(user1ReservationEvent.reservationId).toNotEqual(
            user3ReservationEvent.reservationId,
        );

        Assert.expect(user2ReservationEvent.reservationId).toNotEqual(
            user3ReservationEvent.reservationId,
        );

        const levels: Array<[priceLevel: bigint, availableLiquidity: bigint]> = priceLevels.map(
            (priceLevel) => [priceLevel, liquidityAmount],
        );

        const expectedLiquidityUser1 = calculateExpectedAmountOut(
            satoshisIn,
            slippage,
            levels,
            tokenDecimals,
            orderBook.minimumSatForTickReservation,
            orderBook.minimumLiquidityForTickReservation,
        );

        // We must update priceLevels to reflect the liquidity reserved by user1
        updateReserves(levels, user1Events);

        const expectedLiquidityUser2 = calculateExpectedAmountOut(
            satoshisIn,
            slippage,
            levels,
            tokenDecimals,
            orderBook.minimumSatForTickReservation,
            orderBook.minimumLiquidityForTickReservation,
        );

        // We must update priceLevels to reflect the liquidity reserved by user2
        updateReserves(levels, user2Events);

        const expectedLiquidityUser3 = calculateExpectedAmountOut(
            satoshisIn,
            slippage,
            levels,
            tokenDecimals,
            orderBook.minimumSatForTickReservation,
            orderBook.minimumLiquidityForTickReservation,
        );

        // We must update priceLevels to reflect the liquidity reserved by user3
        updateReserves(levels, user3Events);

        Assert.expect(user1ReservationEvent.expectedAmountOut).toEqual(expectedLiquidityUser1);
        Assert.expect(user2ReservationEvent.expectedAmountOut).toEqual(expectedLiquidityUser2);
        Assert.expect(user3ReservationEvent.expectedAmountOut).toEqual(expectedLiquidityUser3);

        // Verify that the total reserved amount does not exceed the available liquidity
        const totalReserved =
            user1ReservationEvent.expectedAmountOut +
            user2ReservationEvent.expectedAmountOut +
            user3ReservationEvent.expectedAmountOut;

        const totalLiquidity = liquidityAmount * BigInt(priceLevels.length);
        Assert.expect(totalReserved).toBeLessThanOrEqual(totalLiquidity);

        vm.success('Multiple users reserving in the same block handled correctly.');
    });

    await vm.it('should handle overlapping reservations correctly', async () => {
        const user1 = Blockchain.generateRandomAddress();
        const user2 = Blockchain.generateRandomAddress();

        const totalRequiredSat = priceLevels
            .map((priceLevel) => 1000n * priceLevel)
            .reduce((a, b) => a + b, 0n);

        const satoshisInUser1 = totalRequiredSat - 10_000n;

        const satoshisInUser2 = 10_000n; // 0.5 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 9999; // 99.99%

        // User1 makes a reservation
        Blockchain.msgSender = user1;
        const user1Response = await orderBook.reserveTicks(
            tokenAddress,
            satoshisInUser1,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(user1Response.response.error).toBeUndefined();

        // User2 attempts to reserve overlapping liquidity
        Blockchain.msgSender = user2;
        const user2Response = await orderBook.reserveTicks(
            tokenAddress,
            satoshisInUser2,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(user2Response.response.error).toBeUndefined();

        // Check that both reservations were successful but the second user's reservation may be limited by available liquidity
        const user1Events = decodeEvents(user1Response.response.events);
        const user2Events = decodeEvents(user2Response.response.events);

        const user1ReservationEvent = user1Events[
            user1Events.length - 1
        ] as ReservationCreatedEvent;

        const user2ReservationEvent = user2Events[
            user2Events.length - 1
        ] as ReservationCreatedEvent;

        Assert.expect(user1ReservationEvent).toBeDefined();
        Assert.expect(user2ReservationEvent).toBeDefined();

        // Verify that the total reserved amount does not exceed the available liquidity
        const totalReserved =
            user1ReservationEvent.expectedAmountOut + user2ReservationEvent.expectedAmountOut;

        const totalLiquidity = liquidityAmount * BigInt(priceLevels.length);

        Assert.expect(totalReserved).toBeLessThanOrEqual(totalLiquidity);

        vm.success(
            'Overlapping reservations handled correctly with available liquidity allocated.',
        );
    });

    await vm.it('should handle reservations when total requested exceeds liquidity', async () => {
        const user1 = Blockchain.generateRandomAddress();
        const user2 = Blockchain.generateRandomAddress();
        const satoshisInUser1 = 200_000_000n; // 2 BTC
        const satoshisInUser2 = 300_000_000n; // 3 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // User1 makes a reservation
        Blockchain.msgSender = user1;
        const user1Response = await orderBook.reserveTicks(
            tokenAddress,
            satoshisInUser1,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(user1Response.response.error).toBeUndefined();

        // User2 attempts to reserve, but the total liquidity is insufficient
        Blockchain.msgSender = user2;
        await Assert.expect(async () => {
            await orderBook.reserveTicks(
                tokenAddress,
                satoshisInUser2,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
        }).toThrow('Insufficient liquidity to reserve at requested quote');
    });
});
