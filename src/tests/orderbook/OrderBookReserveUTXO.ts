import { Address } from '@btc-vision/transaction';
import { LiquidityReserved, OrderBook } from '../../contracts/order-book/OrderBook.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { calculateExpectedAmountOut, createFeeOutput } from './utils/OrderBookUtils.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('OrderBook Contract reserveTicks Tests - UTXOs', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver;

    const tokenDecimals = 18;
    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const priceLevels: bigint[] = [500n, 1000n, 5000n, 10000n, 50000n];

    vm.beforeEach(async () => {
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
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it(
        'should reserve ticks successfully with valid inputs and sufficient liquidity (consume 100% of available liquidity)',
        async () => {
            const satoshisIn = 200_000_000n; // 1 BTC
            const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
            const minimumLiquidityPerTick = 1n; // Minimum liquidity per tick
            const slippage = 100; // 1%
            const fee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(priceLevels.length);

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

            createFeeOutput(fee);

            const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            // We remove the transaction data after the execution
            Blockchain.transaction = null;

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

    await vm.it('should reserve not reserve ticks if fee provided is too low', async () => {
        const satoshisIn = 200_000_000n; // 1 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
        const minimumLiquidityPerTick = 1n; // Minimum liquidity per tick
        const slippage = 100; // 1%
        const fee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(priceLevels.length - 1); // should only reserve 4 ticks.

        // Prepare ticksLiquidity array
        const ticksLiquidity: Array<[bigint, bigint]> = priceLevels.map((priceLevel) => [
            priceLevel,
            liquidityAmount,
        ]);

        ticksLiquidity.pop(); // Remove the last tick to simulate insufficient fee

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

        createFeeOutput(fee);

        const { result: reservationId, response: callResponse } = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        // We remove the transaction data after the execution
        Blockchain.transaction = null;

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
});
