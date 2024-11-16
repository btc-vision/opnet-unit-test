import { Address } from '@btc-vision/transaction';
import { LiquidityAddedEvent, OrderBook } from '../../contracts/order-book/OrderBook.js';
import { rndPriceLevelMultiple, tickSpacing } from './extern/AddLiquidityExternalConstants.js';
import {
    Assert,
    Blockchain,
    CallResponse,
    OP_20,
    opnet,
    OPNetUnit,
    TransferEvent,
} from '@btc-vision/unit-test-framework';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('Most Basic OrderBook Unit Tests', async (vm: OPNetUnit) => {
    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    await vm.it('should instantiate the order book without crashing', async () => {
        await Assert.expect(async () => {
            const orderBookAddress = Blockchain.generateRandomAddress();
            const orderBook = new OrderBook(Blockchain.txOrigin, orderBookAddress);
            Blockchain.register(orderBook);

            await orderBook.init();

            // Clean up
            orderBook.dispose();
        }).toNotThrow();
    });
});

await opnet('OrderBook Contract addLiquidity Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    const userAddress: Address = receiver; // The user who will add liquidity
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

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
        const mintAmount: number = 10000000;
        await token.mint(userAddress, mintAmount);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        Blockchain.register(orderBook);
        await orderBook.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to add liquidity if tokens are not approved', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const maximumPriceLevel = BigInt(50000);

        // Do not approve tokens

        // Call addLiquidity and expect it to throw an error
        await Assert.expect(async () => {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                maximumAmountIn,
                maximumPriceLevel,
            );
        }).toThrow('Insufficient allowance');
    });

    await vm.it('should fail to add liquidity with zero amount', async () => {
        const maximumAmountIn = BigInt(0);
        const maximumPriceLevel = BigInt(50000);

        // Approve tokens (although amount is zero)
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        // Call addLiquidity and expect it to throw an error
        await Assert.expect(async () => {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                maximumAmountIn,
                maximumPriceLevel,
            );
        }).toThrow('Amount in cannot be zero');
    });

    await vm.it('should fail to add liquidity with zero price level', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const maximumPriceLevel = BigInt(0);

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        // Call addLiquidity and expect it to throw an error
        await Assert.expect(async () => {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                maximumAmountIn,
                maximumPriceLevel,
            );
        }).toThrow('Price level cannot be zero');
    });

    await vm.it('should fail to add liquidity with invalid token address', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const maximumPriceLevel = BigInt(50000);

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        // Use an invalid token address (empty address)
        const invalidTokenAddress = Address.dead();

        await Assert.expect(async () => {
            await orderBook.addLiquidity(
                invalidTokenAddress,
                userAddress.p2tr(Blockchain.network),
                maximumAmountIn,
                maximumPriceLevel,
            );
        }).toThrow('Invalid token address');
    });

    await vm.it('should add liquidity successfully', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500); // The amount of tokens to add as liquidity
        const targetPriceLevel = BigInt(50000); // Price level in satoshis per token

        // User approves the order book contract to spend tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        // Get user's initial token balance
        const initialUserBalance = await token.balanceOf(userAddress);

        // Get order book's initial token balance
        const initialContractBalance = await token.balanceOf(orderBook.address);

        // Call addLiquidity
        const addLiquidity: CallResponse = await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            maximumAmountIn,
            targetPriceLevel,
        );

        // Verify that tokens were transferred from user to contract
        const finalUserBalance = await token.balanceOf(userAddress);
        const finalContractBalance = await token.balanceOf(orderBook.address);

        Assert.expect(finalUserBalance).toEqual(initialUserBalance - maximumAmountIn);
        Assert.expect(finalContractBalance).toEqual(initialContractBalance + maximumAmountIn);

        // Verify that the LiquidityAddedEvent was emitted
        const events = addLiquidity.events;

        const transferEvent = events.shift();
        if (!transferEvent) {
            throw new Error('Transfer event not found');
        }

        // Verify that the TransferEvent was emitted and the tokens were transferred from user to contract
        const decodedTransferEvent: TransferEvent = OP_20.decodeTransferEvent(transferEvent.data);

        Assert.expect(decodedTransferEvent.from).toEqualAddress(userAddress);
        Assert.expect(decodedTransferEvent.to).toEqualAddress(orderBook.address);
        Assert.expect(decodedTransferEvent.value).toEqual(maximumAmountIn);

        // Find the LiquidityAddedEvent
        const liquidityAddedEvent = events.shift();
        if (!liquidityAddedEvent) {
            throw new Error('LiquidityAdded event not found');
        }

        // Assertions on the decoded event
        const decodedAddedLiquidityEvent = OrderBook.decodeLiquidityAddedEvent(
            liquidityAddedEvent.data,
        );

        Assert.expect(decodedAddedLiquidityEvent.tickId).toBeDefined();
        Assert.expect(decodedAddedLiquidityEvent.level).toEqual(targetPriceLevel);
        Assert.expect(decodedAddedLiquidityEvent.liquidityAmount).toEqual(maximumAmountIn);
        Assert.expect(decodedAddedLiquidityEvent.amountOut).toEqual(maximumAmountIn); // As per code, amountOut is same as amountIn
        Assert.expect(decodedAddedLiquidityEvent.receiver).toEqual(userAddress.toString());

        // Verify that the total reserves have been updated
        const reserve = await orderBook.getReserve(tokenAddress);
        Assert.expect(reserve).toEqual(maximumAmountIn);

        // Verify total reserve for a tick
        const reserveForTick = await orderBook.getReserveForTick(tokenAddress, targetPriceLevel);
        Assert.expect(reserveForTick.totalReserved).toEqual(0n);
        Assert.expect(reserveForTick.totalLiquidity).toEqual(maximumAmountIn);
        Assert.expect(reserveForTick.availableLiquidity).toEqual(maximumAmountIn);
    });

    await vm.it('should add liquidity to existing tick', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const maximumPriceLevel = BigInt(50000);

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn * 2n);

        // First addLiquidity
        let callResponse: CallResponse = await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            maximumAmountIn,
            maximumPriceLevel,
        );
        Assert.expect(callResponse.error).toBeUndefined();

        const events = callResponse.events;
        if (!events[1]) {
            throw new Error('LiquidityAdded event not found');
        }

        Assert.expect(events[1].type).toEqual('LiquidityAdded');

        const firstDecodedLiquidityAddEvent: LiquidityAddedEvent =
            OrderBook.decodeLiquidityAddedEvent(events[1].data);

        // Second addLiquidity at the same price level
        callResponse = await orderBook.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            maximumAmountIn,
            maximumPriceLevel,
        );
        Assert.expect(callResponse.error).toBeUndefined();

        // Verify that the total reserve is updated correctly
        const reserve = await orderBook.getReserve(tokenAddress);
        Assert.expect(reserve).toEqual(maximumAmountIn * 2n);

        Assert.expect(callResponse.events.length).toEqual(2);

        // Verify that the tickId is the same in both events
        const transferEvent = callResponse.events.shift();
        const liquidityAddedEvent = callResponse.events.shift();

        Assert.expect(transferEvent).toBeDefined();
        Assert.expect(liquidityAddedEvent).toBeDefined();

        if (!transferEvent || !liquidityAddedEvent) {
            return;
        }

        const secondDecodedLiquidityAddEvent: LiquidityAddedEvent =
            OrderBook.decodeLiquidityAddedEvent(events[1].data);

        Assert.expect(firstDecodedLiquidityAddEvent.tickId).toEqual(
            secondDecodedLiquidityAddEvent.tickId,
        );

        Assert.expect(firstDecodedLiquidityAddEvent.level).toEqual(
            secondDecodedLiquidityAddEvent.level,
        );

        // Verify that the liquidityAmount is cumulative
        Assert.expect(firstDecodedLiquidityAddEvent.liquidityAmount).toEqual(maximumAmountIn);
        Assert.expect(secondDecodedLiquidityAddEvent.liquidityAmount).toEqual(maximumAmountIn);

        // Total liquidity should be maximumAmountIn * 2
        const totalLiquidity =
            firstDecodedLiquidityAddEvent.liquidityAmount +
            secondDecodedLiquidityAddEvent.liquidityAmount;

        Assert.expect(totalLiquidity).toEqual(maximumAmountIn * 2n);
    });
});

/** Performance tests */
await opnet('OrderBook Contract addLiquidity Tests', async (vm: OPNetUnit) => {
    let orderBook: OrderBook;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    const userAddress: Address = receiver; // The user who will add liquidity
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const orderBookAddress: Address = Blockchain.generateRandomAddress();

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
        const mintAmount: number = 10000000;
        await token.mint(userAddress, mintAmount);

        // Instantiate and register the OrderBook contract
        orderBook = new OrderBook(userAddress, orderBookAddress);
        Blockchain.register(orderBook);
        await orderBook.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        orderBook.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should prevent adding liquidity with invalid receiver address', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const maximumPriceLevel = BigInt(50000);
        const invalidReceiver = Address.dead().toString();

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        await Assert.expect(async () => {
            await orderBook.addLiquidity(
                tokenAddress,
                invalidReceiver,
                maximumAmountIn,
                maximumPriceLevel,
            );
        }).toThrow('Invalid address');
    });

    // TODO: Max this work.
    /*await vm.it('should prevent integer overflow when adding large liquidity amounts', async () => {
        const maximumAmountIn = BigInt(
            '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ); // Max uint256

        const maximumPriceLevel = BigInt(
            '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ); // Max uint256

        const slippage = 100; // 1%
        const invalidityPeriod = 10; // 10 blocks

        // Approve tokens (this will also cause an overflow)
        await token.approve(userAddress, orderBook.address, maximumAmountIn);

        await Assert.expect(async () => {
            await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                maximumAmountIn,
                maximumPriceLevel,
                slippage,
                invalidityPeriod,
            );
        }).toThrow('Integer overflow detected');
    });*/

    // Test to ensure tick prices are adjusted according to tickSpacing

    await vm.it('should adjust tick prices according to tickSpacing', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);

        // Approve tokens
        await token.approve(userAddress, orderBook.address, maximumAmountIn * 3n);

        // Price levels that are not aligned with tickSpacing
        const unalignedPriceLevels = [BigInt(15005), BigInt(25007), BigInt(35003)];

        for (const unalignedPriceLevel of unalignedPriceLevels) {
            const callResponse: CallResponse = await orderBook.addLiquidity(
                tokenAddress,
                userAddress.p2tr(Blockchain.network),
                maximumAmountIn,
                unalignedPriceLevel,
            );

            Assert.expect(callResponse.error).toBeUndefined();

            // Decode the LiquidityAddedEvent to get the adjusted level
            const events = callResponse.events;
            const liquidityAddedEvent = events.find((event) => event.type === 'LiquidityAdded');

            if (!liquidityAddedEvent) {
                throw new Error('LiquidityAdded event not found');
            }

            const decodedEvent = OrderBook.decodeLiquidityAddedEvent(liquidityAddedEvent.data);

            // Expected level adjusted to tickSpacing
            const expectedLevel = (unalignedPriceLevel / BigInt(tickSpacing)) * BigInt(tickSpacing);

            Assert.expect(decodedEvent.level).toEqual(expectedLevel);

            vm.log(
                `Unaligned price level ${unalignedPriceLevel} adjusted to ${decodedEvent.level}`,
            );
        }
    });

    // Test for adding 1000 different positions and comparing gas usage

    await vm.it('should add 1000 different positions and compare gas usage', async () => {
        const numberOfTicks = 1000;
        const maximumAmountIn = Blockchain.expandTo18Decimals(1); // Small amount for each tick

        // Approve enough tokens
        await token.approve(
            userAddress,
            orderBook.address,
            maximumAmountIn * BigInt(numberOfTicks) * 2n + maximumAmountIn * 3n, // +3 from previous additions
        );

        const priceLevels: bigint[] = [];

        for (let i = 1; i <= numberOfTicks; i++) {
            priceLevels.push(
                BigInt(i * tickSpacing) *
                    BigInt(rndPriceLevelMultiple[i % rndPriceLevelMultiple.length]),
            );
        }

        // Now, add the rest of the ticks
        for (let i = 0; i < numberOfTicks; i++) {
            const tokenOwner: Address = Blockchain.generateRandomAddress();

            const priceLevel = priceLevels[i];
            const gas = await orderBook.addLiquidity(
                tokenAddress,
                tokenOwner.p2tr(Blockchain.network),
                maximumAmountIn,
                priceLevel,
            );

            vm.log(`Used ${gas.usedGas}gas to add liquidity at price level ${priceLevel}`);
        }

        // add another time more liquidity at the same spot
        for (let i = 0; i < numberOfTicks; i++) {
            const tokenOwner: Address = Blockchain.generateRandomAddress();
            const priceLevel = priceLevels[i];
            await orderBook.addLiquidity(
                tokenAddress,
                tokenOwner.p2tr(Blockchain.network),
                maximumAmountIn,
                priceLevel,
            );
        }

        // Add ticks at lowest, middle, and highest price points to measure gas
        const positionsToTest = [
            { priceLevel: priceLevels[0], position: 'lowest' },
            { priceLevel: priceLevels[Math.floor(numberOfTicks / 2)], position: 'middle' },
            { priceLevel: priceLevels[numberOfTicks - 1], position: 'highest' },
        ];

        const depositAddress = userAddress.p2tr(Blockchain.network);

        for (const { priceLevel, position } of positionsToTest) {
            const callResponse: CallResponse = await orderBook.addLiquidity(
                tokenAddress,
                depositAddress,
                maximumAmountIn,
                priceLevel,
            );

            const gasUsed: bigint = callResponse.usedGas;
            vm.log(
                `Gas used to add liquidity at ${position} price point (level ${priceLevel}): ${gasUsed}gas`,
            );

            Assert.expect(callResponse.error).toBeUndefined();
        }

        // Verify total reserve
        const expectedReserve = maximumAmountIn * BigInt(numberOfTicks * 2 + 3); // +3 from previous additions
        const reserve = await orderBook.getReserve(tokenAddress);

        Assert.expect(reserve).toEqual(expectedReserve);

        // Verify total reserve for a tick
        const reserveForTick = await orderBook.getReserveForTick(tokenAddress, priceLevels[0]);
        Assert.expect(reserveForTick.totalReserved).toEqual(0n);
        Assert.expect(reserveForTick.totalLiquidity).toEqual(maximumAmountIn * 3n);
        Assert.expect(reserveForTick.availableLiquidity).toEqual(maximumAmountIn * 3n);

        vm.success(`First tick reserve: ${reserveForTick.totalLiquidity}`);

        // Verify a random position
        const reserveForTickRnd = await orderBook.getReserveForTick(tokenAddress, priceLevels[5]);
        Assert.expect(reserveForTickRnd.totalReserved).toEqual(0n);
        Assert.expect(reserveForTickRnd.totalLiquidity).toEqual(maximumAmountIn * 2n);
        Assert.expect(reserveForTickRnd.availableLiquidity).toEqual(maximumAmountIn * 2n);

        vm.success(`Random tick reserve: ${reserveForTickRnd.totalLiquidity}`);

        // Verify last position
        const reserveForTickLast = await orderBook.getReserveForTick(
            tokenAddress,
            priceLevels[numberOfTicks - 1],
        );

        Assert.expect(reserveForTickLast.totalReserved).toEqual(0n);
        Assert.expect(reserveForTickLast.totalLiquidity).toEqual(maximumAmountIn * 3n);
        Assert.expect(reserveForTickLast.availableLiquidity).toEqual(maximumAmountIn * 3n);

        vm.success(`Last tick reserve: ${reserveForTickLast.totalLiquidity}`);
    });
});
