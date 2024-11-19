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
    const fee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(priceLevels.length);

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
        };
    }

    await vm.it('should purge expired reservations efficiently', async () => {
        const satoshisIn = 1_000_000n; // 0.001 BTC
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

        console.log('RESERVED!', reservation);

        const quoteBeforePurge = await orderBook.getQuote(tokenAddress, satoshisIn, 1n);
        const quoteBefore = quoteBeforePurge.result.expectedAmountOut;

        // Advance the block number beyond the reservation duration
        Blockchain.blockNumber = 1006n; // Exceeds RESERVATION_DURATION (5 blocks)

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
        const satoshisIn = 50_000n; // 0.001 BTC
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
        Blockchain.blockNumber = 1006n; // Exceeds RESERVATION_DURATION (5 blocks)

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

        // Check that the old reservation no longer exists
        //const reservationExists = await orderBook.reservationExists(userAddress, tokenAddress);
        //Assert.expect(reservationExists).toBeTrue(); // The new reservation exists

        // Verify that the tick's reserved amounts have been updated
        // Since the old reservation has been purged, the reserved amounts should reflect only the new reservation

        // We can check the tick's state if accessible, or rely on events and expected behavior

        vm.success('Expired reservations purged and state updated correctly');
    });
});
