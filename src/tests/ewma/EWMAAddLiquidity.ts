import { Address, NetEvent } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';

await opnet('ewma Contract swap Method Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const satoshisIn: bigint = 1_000_000_000_000n; //100_000n  BTC 1_000_000_000_000n

    const providerCount: bigint = 10n;
    const fee: bigint = EWMA.reservationFeePerProvider * providerCount;

    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    const minimumLiquidityPerTick: bigint = 10n;
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

        // Instantiate and register the ewma contract
        ewma = new EWMA(userAddress, ewmaAddress);
        Blockchain.register(ewma);
        await ewma.init();

        // Add liquidity at specified price levels
        /*for (let i = 0; i < priceLevels.length; i++) {
            const priceLevel = priceLevels[i];

            for (let y = 0; y < usersPerTicks; y++) {
                const user = Blockchain.generateRandomAddress();
                await token.transfer(userAddress, user, liquidityAmount);

                Blockchain.txOrigin = user;
                Blockchain.msgSender = user;

                const tokensAdded = liquidityAmount / BigInt(usersPerTicks - y + 1);
                await token.approve(user, ewma.address, tokensAdded);

                await ewma.addLiquidity(
                    tokenAddress,
                    userAddress.p2tr(Blockchain.network),
                    tokensAdded,
                    priceLevel,
                );

                vm.log(`Added ${tokensAdded} tokens at price level ${priceLevel} by user ${user}`);
            }
        }*/

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        //createFeeOutput(fee);
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    /**
     * Helper function to create a reservation
     */
    async function createReservation() {
        Blockchain.blockNumber = 1000n;

        const reservationResponse = await ewma.reserveTicks(
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

        const decodedReservationEvent = EWMA.decodeReservationCreatedEvent(reservationEvent.data);

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
                const decodedEvent = EWMA.decodeLiquidityReservedEvent(event.data);
                return decodedEvent.level;
            });
    }

    await vm.it('should successfully add liquidity', async () => {
        vm.log(`Reserving levels for ${satoshisIn} satoshis`);

        // Create a reservation
        Blockchain.tracePointers = true;

        await token.approve(userAddress, ewma.address, liquidityAmount);

        const addLiquidity = await ewma.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            satoshisIn,
        );
        console.log(addLiquidity);

        Blockchain.tracePointers = false;
    });

    /*await vm.it('should successfully execute a swap with valid reservation', async () => {
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
        Blockchain.simulateRealEnvironment = true;

        const swappedAt = Date.now();
        const swapResponse = await ewma.swap(tokenAddress, false, levels);
        vm.debug(
            `(${Date.now() - swappedAt}ms) Swap executed! Gas cost: ${gas2Sat(swapResponse.response.usedGas)}sat (${gas2BTC(swapResponse.response.usedGas)} BTC, $${gas2USD(swapResponse.response.usedGas)})`,
        );

        console.log(
            swapResponse,
            `pointers loaded: ${ewma.loadedPointers}, pointers saved: ${ewma.storedPointers}`,
        );

        Blockchain.simulateRealEnvironment = false;
        Blockchain.tracePointers = false;
    });*/
});
