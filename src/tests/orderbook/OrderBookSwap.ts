import { Address, NetEvent } from '@btc-vision/transaction';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from '../../tests/utils/TransactionUtils.js';

await opnet('OrderBook Contract swap Method Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const priceLevels: bigint[] = [500n, 1000n, 5000n, 10000n, 50000n];
    const satoshisIn: bigint = 100_000_000n; // 1 BTC
    const fee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(priceLevels.length);
    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    const minimumLiquidityPerTick: bigint = 1n;
    const slippage: number = 100; // 1%

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
        await token.mint(userAddress, 10_000_000);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        Blockchain.register(orderBook);
        await orderBook.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        // Approve tokens for adding liquidity
        await token.approve(
            userAddress,
            orderBook.address,
            liquidityAmount * BigInt(priceLevels.length),
        );

        // Add liquidity at specified price levels
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

    /**
     * Helper function to create a reservation
     */
    async function createReservation() {
        Blockchain.blockNumber = 1000n;

        const reservationResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(reservationResponse.response.error).toBeUndefined();

        // Decode the ReservationCreatedEvent to get the reservation ID
        const reservationEvent =
            reservationResponse.response.events[reservationResponse.response.events.length - 1];

        if (!reservationEvent) {
            throw new Error('ReservationCreated event not found');
        }

        const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(
            reservationEvent.data,
        );

        Blockchain.blockNumber = 1001n;

        return {
            reservationId: decodedReservationEvent.reservationId,
            expectedAmountOut: decodedReservationEvent.expectedAmountOut,
            events: reservationResponse.response.events,
        };
    }

    /**
     * Helper function to get the levels from LiquidityReserved events
     */
    function getReservedLevels(events: NetEvent[]): bigint[] {
        return events
            .filter((event) => event.type === 'LiquidityReserved')
            .map((event) => {
                const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);
                return decodedEvent.level;
            });
    }

    await vm.it('should successfully execute a swap with valid reservation', async () => {
        // Create a reservation
        const { expectedAmountOut, events } = await createReservation();

        // Get the levels from the reservation events
        const levels: bigint[] = getReservedLevels(events);

        // Execute the swap
        Blockchain.tracePointers = true;
        const swapResponse = await orderBook.swap(tokenAddress, false, levels);

        Assert.expect(swapResponse.response.error).toBeUndefined();

        // Check the SwapExecutedEvent
        const swapEvent = swapResponse.response.events.find(
            (event) => event.type === 'SwapExecuted',
        );

        if (!swapEvent) {
            throw new Error('SwapExecuted event not found');
        }

        Assert.expect(swapEvent).toBeDefined();

        const decodedSwapEvent = OrderBook.decodeSwapExecutedEvent(swapEvent.data);
        console.log(decodedSwapEvent);

        Assert.expect(decodedSwapEvent.buyer).toEqualAddress(userAddress);
        Assert.expect(decodedSwapEvent.amountOut).toEqual(expectedAmountOut);

        vm.success('Swap executed successfully with valid reservation.');
    });

    /*await vm.it(
        'should revert swap when reservation is close to expiration during simulation',
        async () => {
            // Create a reservation
            const { events } = await createReservation();

            // Advance the blockchain to 4 blocks before expiration (assuming RESERVATION_DURATION = 5)
            await Blockchain.advanceBlocks(4);

            // Get the levels from the reservation events
            const levels = getReservedLevels(events);

            // Attempt to simulate the swap
            await Assert.expect(async () => {
                await orderBook.swap(tokenAddress, true, levels);
            }).toThrow('Reservation is close to being expired');

            vm.success('Swap simulation correctly reverted due to near expiration.');
        },
    );

    await vm.it('should revert swap when reservation has expired', async () => {
        // Create a reservation
        const { events } = await createReservation();

        // Advance the blockchain beyond the reservation duration
        await Blockchain.advanceBlocks(6);

        // Get the levels from the reservation events
        const levels = getReservedLevels(events);

        // Attempt to execute the swap
        await Assert.expect(async () => {
            await orderBook.swap(tokenAddress, false, levels);
        }).toThrow('Reservation');

        vm.success('Swap correctly reverted due to expired reservation.');
    });

    await vm.it('should revert swap when no tokens are acquired', async () => {
        // Create a reservation
        const { events } = await createReservation();

        // Manually empty the liquidity at the ticks
        const levels = getReservedLevels(events);
        for (const level of levels) {
            await orderBook.removeLiquidity(tokenAddress, [level]);
        }

        // Attempt to execute the swap
        await Assert.expect(async () => {
            await orderBook.swap(tokenAddress, false, levels);
        }).toThrow('ORDER_BOOK: No tokens acquired.');

        vm.success('Swap correctly reverted when no tokens are acquired.');
    });

    await vm.it('should handle swap with multiple ticks and providers', async () => {
        // Add more liquidity with a different provider at the same ticks
        const provider2 = Blockchain.generateRandomAddress();
        Blockchain.msgSender = provider2;
        Blockchain.txOrigin = provider2;
        await token.mint(provider2, Blockchain.expandToDecimal(1_000_000, tokenDecimals));
        await token.approve(
            provider2,
            orderBook.address,
            liquidityAmount * BigInt(priceLevels.length),
        );
        for (const priceLevel of priceLevels) {
            await orderBook.addLiquidity(
                tokenAddress,
                provider2.p2tr(Blockchain.network),
                liquidityAmount,
                priceLevel,
            );
        }

        // Switch back to user
        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        // Create a reservation
        const { expectedAmountOut, events } = await createReservation();

        // Get the levels from the reservation events
        const levels = getReservedLevels(events);

        // Execute the swap
        const swapResponse = await orderBook.swap(tokenAddress, false, levels);

        Assert.expect(swapResponse.response.error).toBeUndefined();

        // Check the SwapExecutedEvent
        const swapEvent = swapResponse.response.events.find(
            (event) => event.type === 'SwapExecuted',
        );

        Assert.expect(swapEvent).toBeDefined();

        const decodedSwapEvent = OrderBook.decodeSwapExecutedEvent(swapEvent.data);

        Assert.expect(decodedSwapEvent.buyer).toEqualAddress(userAddress);
        Assert.expect(decodedSwapEvent.amountOut).toEqual(expectedAmountOut);

        vm.success('Swap executed successfully with multiple ticks and providers.');
    });

    await vm.it('should revert swap if reservation is missing levels', async () => {
        // Create a reservation
        const { events } = await createReservation();

        // Get the levels from the reservation events
        const levels = getReservedLevels(events);

        // Remove one level from the levels array
        const incompleteLevels = levels.slice(1);

        // Attempt to execute the swap
        await Assert.expect(async () => {
            await orderBook.swap(tokenAddress, false, incompleteLevels);
        }).toThrow();

        vm.success('Swap correctly reverted when reservation levels are incomplete.');
    });

    await vm.it('should handle swap with partial fills', async () => {
        // Create a reservation
        const { expectedAmountOut, events } = await createReservation();

        // Manually remove liquidity from some ticks to simulate partial fill
        const levels = getReservedLevels(events);
        const removedLevels = levels.slice(0, 2);
        await orderBook.removeLiquidity(tokenAddress, removedLevels);

        // Execute the swap
        const swapResponse = await orderBook.swap(tokenAddress, false, levels);

        Assert.expect(swapResponse.response.error).toBeUndefined();

        // Check the SwapExecutedEvent
        const swapEvent = swapResponse.response.events.find(
            (event) => event.type === 'SwapExecuted',
        );

        Assert.expect(swapEvent).toBeDefined();

        const decodedSwapEvent = OrderBook.decodeSwapExecutedEvent(swapEvent.data);

        // Expected amount out should be less due to partial fill
        Assert.expect(decodedSwapEvent.amountOut).toBeLessThan(expectedAmountOut);

        vm.success('Swap executed with partial fills due to reduced liquidity.');
    });

    await vm.it('should revert swap when reservation does not exist', async () => {
        // Attempt to execute a swap without a reservation
        const levels = priceLevels;

        await Assert.expect(async () => {
            await orderBook.swap(tokenAddress, false, levels);
        }).toThrow('Reservation');

        vm.success('Swap correctly reverted when reservation does not exist.');
    });

    await vm.it('should handle swap simulation correctly', async () => {
        // Create a reservation
        const { events } = await createReservation();

        // Get the levels from the reservation events
        const levels = getReservedLevels(events);

        // Simulate the swap
        const swapResponse = await orderBook.swap(tokenAddress, true, levels);

        Assert.expect(swapResponse.response.error).toBeUndefined();

        // Check that no state changes occurred (e.g., reservation still exists)
        const reservationExists = await orderBook.reservationExists(userAddress, tokenAddress);
        Assert.expect(reservationExists).toBeTrue();

        vm.success('Swap simulation executed correctly without state changes.');
    });

    await vm.it('should handle swap when fee credits are considered', async () => {
        // Assuming fee credits are used during swap
        // Create a reservation
        const { expectedAmountOut, events } = await createReservation();

        // Get the levels from the reservation events
        const levels = getReservedLevels(events);

        // Ensure fee credits are available
        const initialCreditsResponse = await orderBook.creditsOf(userAddress);
        const initialCredits = initialCreditsResponse.result;

        // Execute the swap
        const swapResponse = await orderBook.swap(tokenAddress, false, levels);

        Assert.expect(swapResponse.response.error).toBeUndefined();

        // Check the SwapExecutedEvent
        const swapEvent = swapResponse.response.events.find(
            (event) => event.type === 'SwapExecuted',
        );

        Assert.expect(swapEvent).toBeDefined();

        const decodedSwapEvent = OrderBook.decodeSwapExecutedEvent(swapEvent.data);

        Assert.expect(decodedSwapEvent.buyer).toEqualAddress(userAddress);
        Assert.expect(decodedSwapEvent.amountOut).toEqual(expectedAmountOut);

        // Check that fee credits have been adjusted
        const finalCreditsResponse = await orderBook.creditsOf(userAddress);
        const finalCredits = finalCreditsResponse.result;

        Assert.expect(finalCredits).toBeLessThan(initialCredits);

        vm.success('Swap executed successfully with fee credits considered.');
    });*/
});
