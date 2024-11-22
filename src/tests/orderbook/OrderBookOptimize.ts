import { Address, NetEvent } from '@btc-vision/transaction';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { createFeeOutput, gas2BTC, gas2Sat, gas2USD } from './utils/OrderBookUtils.js';

await opnet('OrderBook Contract swap Method Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const priceLevels: bigint[] = [];

    for (let i = 0; i < 25; i++) {
        priceLevels.push(100n + BigInt(i) * 10n);
    }

    const satoshisIn: bigint = 1_000_000_000_000n; //100_000n  BTC 1_000_000_000_000n
    const fee: bigint = OrderBook.fixedFeeRatePerTickConsumed * BigInt(priceLevels.length);
    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    const minimumLiquidityPerTick: bigint = 10n;
    const slippage: number = 100; // 1%

    const usersPerTicks: number = 3;

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

        // Add liquidity at specified price levels
        for (let i = 0; i < priceLevels.length; i++) {
            const priceLevel = priceLevels[i];

            for (let y = 0; y < usersPerTicks; y++) {
                const user = Blockchain.generateRandomAddress();
                await token.transfer(userAddress, user, liquidityAmount);

                Blockchain.txOrigin = user;
                Blockchain.msgSender = user;

                const tokensAdded = liquidityAmount / BigInt(usersPerTicks - y + 1);
                await token.approve(user, orderBook.address, tokensAdded);

                await orderBook.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    tokensAdded,
                    priceLevel,
                );

                vm.log(`Added ${tokensAdded} tokens at price level ${priceLevel} by user ${user}`);
            }
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

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
            gasUsed: reservationResponse.response.usedGas,
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
        vm.log(`Reserving levels for ${satoshisIn} satoshis`);

        // Create a reservation
        const reservation = await createReservation();
        const gasUsed = reservation.gasUsed;
        vm.debug(
            `Reservation created! Params: expectedAmountOut: ${reservation.expectedAmountOut}, gas cost: ${gas2Sat(gasUsed)}sat (${gas2BTC(gasUsed)} BTC, $${gas2USD(gasUsed)})`,
        );

        // Get the levels from the reservation events
        const levels: bigint[] = getReservedLevels(reservation.events);
        vm.debug(`Reserved levels: ${levels}`);

        // Execute the swap
        Blockchain.tracePointers = true;

        const swapResponse = await orderBook.swap(tokenAddress, false, levels);
        vm.debug(
            `Swap executed! Gas cost: ${gas2Sat(swapResponse.response.usedGas)}sat (${gas2BTC(swapResponse.response.usedGas)} BTC, $${gas2USD(swapResponse.response.usedGas)})`,
        );

        console.log(swapResponse);

        Blockchain.tracePointers = false;

        /*const swapResponse = await orderBook.swap(tokenAddress, false, levels);

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
        console.log(decodedSwapEvent);*/
    });
});
