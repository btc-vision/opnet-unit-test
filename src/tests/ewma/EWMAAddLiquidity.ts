import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    CallResponse,
    OP_20,
    opnet,
    OPNetUnit,
    TransferEvent,
} from '@btc-vision/unit-test-framework';
import { EWMA, LiquidityAddedEvent } from '../../contracts/ewma/EWMA.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('Most Basic EWMA Unit Tests', async (vm: OPNetUnit) => {
    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    await vm.it('should instantiate the order book without crashing', async () => {
        await Assert.expect(async () => {
            const ewmaAddress = Blockchain.generateRandomAddress();
            const ewma = new EWMA(Blockchain.txOrigin, ewmaAddress);
            Blockchain.register(ewma);

            await ewma.init();

            // Clean up
            ewma.dispose();
        }).toNotThrow();
    });
});

await opnet('EWMA Contract addLiquidity Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    const userAddress: Address = receiver; // The user who will add liquidity
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

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
            decimals: 18,
        });
        Blockchain.register(token);

        await token.init();

        // Mint tokens to the user
        const mintAmount: number = 10000000;
        await token.mint(userAddress, mintAmount);

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress);
        Blockchain.register(ewma);
        await ewma.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to add liquidity if tokens are not approved', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);

        // Do not approve tokens

        // Call addLiquidity and expect it to throw an error
        await Assert.expect(async () => {
            await ewma.addLiquidity(tokenAddress, userAddress.p2tr(Blockchain.network), amountIn);
        }).toThrow('Insufficient allowance');
    });

    await vm.it('should fail to add liquidity with zero amount', async () => {
        const amountIn = BigInt(0);

        // Approve tokens (although amount is zero)
        await token.approve(userAddress, ewma.address, amountIn);

        // Call addLiquidity and expect it to throw an error
        await Assert.expect(async () => {
            await ewma.addLiquidity(tokenAddress, userAddress.p2tr(Blockchain.network), amountIn);
        }).toThrow('Amount in cannot be zero');
    });

    await vm.it('should fail to add liquidity with invalid token address', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);

        // Approve tokens
        await token.approve(userAddress, ewma.address, amountIn);

        // Use an invalid token address (empty address)
        const invalidTokenAddress = Address.dead();

        await Assert.expect(async () => {
            await ewma.addLiquidity(
                invalidTokenAddress,
                userAddress.p2tr(Blockchain.network),
                amountIn,
            );
        }).toThrow('Invalid token address');
    });

    await vm.it('should add liquidity successfully', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500); // The amount of tokens to add as liquidity

        // User approves the order book contract to spend tokens
        await token.approve(userAddress, ewma.address, amountIn);

        // Get user's initial token balance
        const initialUserBalance = await token.balanceOf(userAddress);

        // Get order book's initial token balance
        const initialContractBalance = await token.balanceOf(ewma.address);

        // Call addLiquidity
        const addLiquidity: CallResponse = await ewma.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            amountIn,
        );

        // Verify that tokens were transferred from user to contract
        const finalUserBalance = await token.balanceOf(userAddress);
        const finalContractBalance = await token.balanceOf(ewma.address);

        Assert.expect(finalUserBalance).toEqual(initialUserBalance - amountIn);
        Assert.expect(finalContractBalance).toEqual(initialContractBalance + amountIn);

        // Verify that the LiquidityAddedEvent was emitted
        const events = addLiquidity.events;

        const transferEvent = events.shift();
        if (!transferEvent) {
            throw new Error('Transfer event not found');
        }

        // Verify that the TransferEvent was emitted and the tokens were transferred from user to contract
        const decodedTransferEvent: TransferEvent = OP_20.decodeTransferEvent(transferEvent.data);

        Assert.expect(decodedTransferEvent.from).toEqualAddress(userAddress);
        Assert.expect(decodedTransferEvent.to).toEqualAddress(ewma.address);
        Assert.expect(decodedTransferEvent.value).toEqual(amountIn);

        // Find the LiquidityAddedEvent
        const liquidityAddedEvent = events.shift();
        if (!liquidityAddedEvent) {
            throw new Error('LiquidityAdded event not found');
        }

        // Assertions on the decoded event
        const decodedAddedLiquidityEvent = EWMA.decodeLiquidityAddedEvent(liquidityAddedEvent.data);
        console.log(decodedAddedLiquidityEvent);

        Assert.expect(decodedAddedLiquidityEvent.totalLiquidity).toEqual(amountIn);
        Assert.expect(decodedAddedLiquidityEvent.receiver).toEqual(userAddress.toString());

        // Verify that the total reserves have been updated
        const reserve = await ewma.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toEqual(amountIn);
    });

    await vm.it('should add liquidity to existing tick', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);
        const maximumPriceLevel = BigInt(50000);

        // Approve tokens
        await token.approve(userAddress, ewma.address, amountIn * 2n);

        // First addLiquidity
        let callResponse: CallResponse = await ewma.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            amountIn,
        );
        Assert.expect(callResponse.error).toBeUndefined();

        const events = callResponse.events;
        if (!events[1]) {
            throw new Error('LiquidityAdded event not found');
        }

        Assert.expect(events[1].type).toEqual('LiquidityAdded');

        const firstDecodedLiquidityAddEvent: LiquidityAddedEvent = EWMA.decodeLiquidityAddedEvent(
            events[1].data,
        );

        // Second addLiquidity at the same price level
        callResponse = await ewma.addLiquidity(
            tokenAddress,
            userAddress.p2tr(Blockchain.network),
            amountIn,
        );
        Assert.expect(callResponse.error).toBeUndefined();

        // Verify that the total reserve is updated correctly
        const reserve = await ewma.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toEqual(amountIn * 2n);

        Assert.expect(callResponse.events.length).toEqual(2);

        // Verify that the tickId is the same in both events
        const transferEvent = callResponse.events.shift();
        const liquidityAddedEvent = callResponse.events.shift();

        Assert.expect(transferEvent).toBeDefined();
        Assert.expect(liquidityAddedEvent).toBeDefined();

        if (!transferEvent || !liquidityAddedEvent) {
            return;
        }

        const secondDecodedLiquidityAddEvent: LiquidityAddedEvent = EWMA.decodeLiquidityAddedEvent(
            events[1].data,
        );

        // Verify that the liquidityAmount is cumulative
        Assert.expect(firstDecodedLiquidityAddEvent.totalLiquidity).toEqual(amountIn);
        Assert.expect(secondDecodedLiquidityAddEvent.totalLiquidity).toEqual(amountIn);

        // Total liquidity should be maximumAmountIn * 2
        const totalLiquidity =
            firstDecodedLiquidityAddEvent.totalLiquidity +
            secondDecodedLiquidityAddEvent.totalLiquidity;

        Assert.expect(totalLiquidity).toEqual(amountIn * 2n);
    });
});

/** Performance tests */
await opnet('EWMA Contract addLiquidity Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    const userAddress: Address = receiver; // The user who will add liquidity
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

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
            decimals: 18,
        });
        Blockchain.register(token);

        await token.init();

        // Mint tokens to the user
        const mintAmount: number = 10000000;
        await token.mint(userAddress, mintAmount);

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress);
        Blockchain.register(ewma);
        await ewma.init();

        // Set msgSender to the user
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should prevent adding liquidity with invalid receiver address', async () => {
        const maximumAmountIn = Blockchain.expandTo18Decimals(500);
        const amountIn = BigInt(50000);
        const invalidReceiver = Address.dead().toString();

        // Approve tokens
        await token.approve(userAddress, ewma.address, amountIn);

        await Assert.expect(async () => {
            await ewma.addLiquidity(tokenAddress, invalidReceiver, amountIn);
        }).toThrow('Invalid address');
    });

    // Test for adding 1000 different positions and comparing gas usage

    await vm.it('should add 1000 different positions and compare gas usage', async () => {
        const numberDeposits = 1000;
        const amountIn = Blockchain.expandTo18Decimals(1); // Small amount for each tick

        // Approve enough tokens
        await token.approve(
            userAddress,
            ewma.address,
            amountIn * BigInt(numberDeposits) * 2n + amountIn * 3n, // +3 from previous additions
        );

        // Now, add the rest of the ticks
        for (let i = 0; i < numberDeposits; i++) {
            const tokenOwner: Address = Blockchain.generateRandomAddress();

            const gas = await ewma.addLiquidity(
                tokenAddress,
                tokenOwner.p2tr(Blockchain.network),
                amountIn,
            );

            vm.log(`Used ${gas.usedGas}gas to add liquidity`);
        }

        const reserve = await ewma.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toEqual(amountIn * BigInt(numberDeposits));

        vm.debug('Done adding liquidity');
    });
});
