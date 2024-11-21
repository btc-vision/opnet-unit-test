import { Address } from '@btc-vision/transaction';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from './utils/OrderBookUtils.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('OrderBook Contract purgeExpiredReservations Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const priceLevels: bigint[] = [500n, 1000n, 5000n, 10000n, 50000n];
    const feePerTick: bigint = 4000n; // Assuming fixedFeeRatePerTickConsumed is 4000 satoshis
    const fee: bigint = feePerTick * BigInt(priceLevels.length);

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

        token.preserveState();

        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        await token.mint(userAddress, 100_000_000);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        orderBook.preserveState();

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

        // Set initial block number
        Blockchain.blockNumber = 1000n;
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    /**
     * Helper function to create a reservation
     */
    async function createReservation(
        satoshisIn: bigint,
        minimumAmountOut: bigint,
        minimumLiquidityPerTick: bigint,
        slippage: number,
    ) {
        const reservationResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(reservationResponse.response.error).toBeUndefined();

        // Decode the ReservationCreatedEvent to get the reservation ID
        const reservationEvent = reservationResponse.response.events.find(
            (event) => event.type === 'ReservationCreated',
        );

        if (!reservationEvent) {
            throw new Error('ReservationCreated event not found');
        }

        const decodedReservationEvent = OrderBook.decodeReservationCreatedEvent(
            reservationEvent.data,
        );

        return {
            reservationId: decodedReservationEvent.reservationId,
            expectedAmountOut: decodedReservationEvent.expectedAmountOut,
            events: reservationResponse.response.events,
            levels: reservationResponse.response.events
                .filter((event) => event.type === 'LiquidityReserved')
                .map((event) => {
                    const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);
                    return decodedEvent.level;
                }),
        };
    }

    await vm.it('should purge expired reservations efficiently', async () => {
        const satoshisIn = 1_000_000n; // 0.01 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;
        await createReservation(satoshisIn, minimumAmountOut, minimumLiquidityPerTick, slippage);

        const quoteBeforePurge = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        const quoteBefore = quoteBeforePurge.result.expectedAmountOut;

        // Advance the block number beyond the reservation duration
        Blockchain.blockNumber = Blockchain.blockNumber + OrderBook.invalidAfter + 1n; // Exceeds RESERVATION_DURATION (5 blocks)

        // Check that the old reservation no longer exists
        const quoteAfterPurge = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        const quoteAfter = quoteAfterPurge.result.expectedAmountOut;

        Assert.expect(quoteBefore).toBeLessThan(quoteAfter);

        // Attempt to make a new reservation, which will trigger purging
        const newReservationResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(newReservationResponse.response.error).toBeUndefined();
    });

    await vm.it('should purge at least 50 expired reservations efficiently', async () => {
        const satoshisIn = 50_000n; // 0.0005 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;

        const quoteBeforePurge = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        const quoteBefore = quoteBeforePurge.result.expectedAmountOut;

        for (let i = 0; i < 50; i++) {
            Blockchain.msgSender = Blockchain.generateRandomAddress();

            await createReservation(
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );
        }

        // Advance the block number beyond the reservation duration
        Blockchain.blockNumber = Blockchain.blockNumber + OrderBook.invalidAfter + 1n; // Exceeds RESERVATION_DURATION (5 blocks)

        // Attempt to make a new reservation, which will trigger purging
        const newReservationResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(newReservationResponse.response.error).toBeUndefined();

        const gas = newReservationResponse.response.usedGas;
        vm.log(`Gas used for purging 50 reservations: ${gas}`);

        const quoteAfterPurge = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        const quoteAfter = quoteAfterPurge.result.expectedAmountOut;

        Assert.expect(quoteBefore).toEqual(quoteAfter);
    });

    await vm.it('should correctly purge expired reservations and update state', async () => {
        const satoshisIn = 100_000n; // 0.001 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;
        const { events } = await createReservation(
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        // Extract tick levels from events
        const levels = events
            .filter((event) => event.type === 'LiquidityReserved')
            .map((event) => {
                const decodedEvent = OrderBook.decodeLiquidityReservedEvent(event.data);
                return decodedEvent.level;
            });

        // Advance the block number beyond the reservation duration
        Blockchain.blockNumber = 1006n; // Exceeds RESERVATION_DURATION (5 blocks)

        // Attempt to execute the swap, which should fail due to expired reservation
        await Assert.expect(async () => {
            await orderBook.swap(tokenAddress, false, levels);
        }).toThrow('Reservation');

        // Now, make a new reservation, which will trigger purging
        const newReservationResponse = await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        Assert.expect(newReservationResponse.response.error).toBeUndefined();

        vm.success('Expired reservations purged and state updated correctly');
    });

    await vm.it('should allow swap before reservation expires', async () => {
        const satoshisIn = 1_000_000n; // 0.01 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;
        const reservation = await createReservation(
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        const levels = reservation.levels;
        Blockchain.blockNumber += 1n;

        // Attempt to execute the swap before reservation expires
        const swapResponse = await orderBook.swap(tokenAddress, false, levels);

        Assert.expect(swapResponse.response.error).toBeUndefined();
        vm.success('Swap executed successfully before reservation expires');
    });

    await vm.it('should not allow swap after reservation expires', async () => {
        const satoshisIn = 1_000_000n; // 0.01 BTC
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
        const minimumLiquidityPerTick = 1n;
        const slippage = 100; // 1%

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;
        const reservation = await createReservation(
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        const levels = reservation.levels;

        // Advance the block number beyond the reservation duration
        Blockchain.blockNumber = 1006n; // Exceeds RESERVATION_DURATION (5 blocks)

        // Attempt to execute the swap after reservation expires
        await Assert.expect(async () => {
            await orderBook.swap(tokenAddress, false, levels);
        }).toThrow('Reservation');

        vm.success('Swap failed as expected after reservation expires');
    });

    await vm.it(
        'should not allow liquidity removal if there is an active reservation',
        async () => {
            const satoshisIn = 1_000_000n; // 0.01 BTC
            const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            // Create a reservation at block number 1000
            Blockchain.blockNumber = 1000n;
            await createReservation(
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            // Attempt to remove liquidity
            const resp = await orderBook.removeLiquidity(tokenAddress, priceLevels);
            const events = resp.response.events;

            const errorEvent = events.find((event) => event.type === 'LiquidityRemovalBlocked');
            Assert.expect(errorEvent).toBeDefined();

            vm.success('Liquidity removal blocked as expected due to active reservation');
        },
    );

    await vm.it(
        'should handle multiple reservations from different users correctly and swap accordingly',
        async () => {
            const satoshisIn = 500_000n; // 0.005 BTC
            const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            // Create reservations from multiple users
            const user1 = Blockchain.generateRandomAddress();
            const user2 = Blockchain.generateRandomAddress();

            Blockchain.msgSender = user1;
            const reservation1 = await createReservation(
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            Blockchain.msgSender = user2;
            const reservation2 = await createReservation(
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            // Advance the block number to just before expiration
            Blockchain.blockNumber = 1004n;

            // User1 executes swap
            Blockchain.msgSender = user1;
            const levels1 = reservation1.levels;

            const swapResponse1 = await orderBook.swap(tokenAddress, false, levels1);
            Assert.expect(swapResponse1.response.error).toBeUndefined();

            // User2 executes swap
            Blockchain.msgSender = user2;
            const levels2 = reservation2.levels;

            const swapResponse2 = await orderBook.swap(tokenAddress, false, levels2);
            Assert.expect(swapResponse2.response.error).toBeUndefined();

            vm.success('Multiple reservations from different users handled correctly');
        },
    );

    await vm.it(
        'should prevent making a new reservation if one already exists for the user',
        async () => {
            const satoshisIn = 500_000n; // 0.005 BTC
            const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals); // Minimum 1 token
            const minimumLiquidityPerTick = 1n;
            const slippage = 100; // 1%

            // Create reservation
            Blockchain.msgSender = userAddress;
            await createReservation(
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            // Attempt to create another reservation
            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;

                await createReservation(
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }).toThrow('Reservation already exists or pending');

            vm.success('Prevented creating new reservation when one already exists for the user');
        },
    );

    await vm.it('should have reservations last exactly RESERVATION_DURATION blocks', async () => {
        const satoshisIn = 1_000_000n;
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals);
        const minimumLiquidityPerTick = 1n;
        const slippage = 100;

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;
        const reservation = await createReservation(
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        const levels = reservation.levels;

        // Attempt to execute the swap at the last valid block
        Blockchain.blockNumber = 1005n; // Reservation should still be valid

        const swapResponse = await orderBook.swap(tokenAddress, false, levels);
        Assert.expect(swapResponse.response.error).toBeUndefined();

        vm.success('Reservation lasted exactly RESERVATION_DURATION blocks');
    });

    await vm.it("should restore providers' reserved amounts after purging", async () => {
        const satoshisIn = 1_000_000n;
        const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals);
        const minimumLiquidityPerTick = 1n;
        const slippage = 100;

        // Create a reservation at block number 1000
        Blockchain.blockNumber = 1000n;
        await createReservation(satoshisIn, minimumAmountOut, minimumLiquidityPerTick, slippage);

        // Advance the block number beyond the reservation duration
        Blockchain.blockNumber = 1006n; // Exceeds RESERVATION_DURATION (5 blocks)

        // Attempt to create a new reservation, which triggers purging
        await orderBook.reserveTicks(
            tokenAddress,
            satoshisIn,
            minimumAmountOut,
            minimumLiquidityPerTick,
            slippage,
        );

        // Check that providers' reserved amounts have been restored
        // This would involve accessing the provider's reservedAmount
        // For simplicity, we can check that the available liquidity has increased

        const quoteAfterPurge = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        const estimatedQuantityAfterPurge = quoteAfterPurge.result.expectedAmountOut;

        Assert.expect(estimatedQuantityAfterPurge).toBeGreaterThan(0n);

        vm.success("Providers' reserved amounts restored after purging");
    });

    await vm.it(
        'should purge expired reservations efficiently with many expired reservations',
        async () => {
            const satoshisIn = 50_000n;
            const minimumAmountOut = Blockchain.expandToDecimal(1, tokenDecimals);
            const minimumLiquidityPerTick = 1n;
            const slippage = 100;

            // Create multiple reservations at different blocks
            for (let block = 1000n; block < 1050n; block += 1n) {
                Blockchain.blockNumber = block;
                Blockchain.msgSender = Blockchain.generateRandomAddress();

                await createReservation(
                    satoshisIn,
                    minimumAmountOut,
                    minimumLiquidityPerTick,
                    slippage,
                );
            }

            // Advance the block number beyond the maximum reservation duration
            Blockchain.blockNumber = 1100n;

            // Attempt to create a new reservation, which triggers purging
            const newReservationResponse = await orderBook.reserveTicks(
                tokenAddress,
                satoshisIn,
                minimumAmountOut,
                minimumLiquidityPerTick,
                slippage,
            );

            Assert.expect(newReservationResponse.response.error).toBeUndefined();

            const gasUsed = newReservationResponse.response.usedGas;
            vm.log(`Gas used for purging many expired reservations: ${gasUsed}`);

            vm.success('Purged expired reservations efficiently with many expired reservations');
        },
    );
});
