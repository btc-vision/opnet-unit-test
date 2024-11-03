import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { MotoswapPool } from '../contracts/MotoswapPool.js';
import { Address, BinaryReader } from '@btc-vision/transaction';
import { OP_20 } from '../contracts/OP_20.js';
import { ROUTER_ADDRESS } from '../contracts/configs.js';
import { CallResponse } from '../opnet/interfaces/CallResponse.js';

await opnet('Motoswap Pool', async (vm: OPNetUnit) => {
    const token0Address: Address = Blockchain.generateRandomAddress();
    const token1Address: Address = Blockchain.generateRandomAddress();

    const receiver: Address = Blockchain.generateRandomAddress();
    Blockchain.msgSender = ROUTER_ADDRESS;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    await vm.it('should init a pool', async () => {
        await Assert.expect(async () => {
            const pool = new MotoswapPool(token0Address, token1Address);
            await pool.init();
            pool.dispose();
        }).toNotThrow();
    });

    /** Init OP_20 */
    const token0: OP_20 = new OP_20({
        fileName: 'MyToken',
        deployer: Blockchain.txOrigin,
        address: token0Address,
        decimals: 18,
    });

    Blockchain.register(token0);

    const token1: OP_20 = new OP_20({
        fileName: 'MyToken',
        deployer: Blockchain.txOrigin,
        address: token1Address,
        decimals: 18,
    });

    Blockchain.register(token1);

    // Declare all the request contracts
    const pool: MotoswapPool = new MotoswapPool(token0Address, token1Address);
    Blockchain.register(pool);

    vm.beforeEach(async () => {
        await Blockchain.init();
    });

    vm.afterAll(() => {
        Blockchain.dispose();
    });

    vm.afterEach(() => {
        Blockchain.dispose();
    });

    async function mintTokens() {
        await token0.resetStates();
        await token1.resetStates();

        const amountA = 11000000;
        const amountB = 11000000;

        // Mint some token
        await token0.mint(receiver, amountA);
        await token1.mint(receiver, amountB);

        const currentBalanceTokenA = await token0.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenA).toEqual(amountA);

        const currentBalanceTokenB = await token1.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenB).toEqual(amountB);
    }

    await vm.beforeAll(async () => {
        await Blockchain.init();

        await mintTokens();
    });

    /** TESTS */
    await vm.it('should instantiate a pool', async () => {
        await pool.initializePool();
    });

    await vm.it('should return the correct token0 and token1', async () => {
        const _token0: Address = await pool.getToken0();
        const _token1: Address = await pool.getToken1();

        Assert.expect(_token0).toEqualAddress(token0Address);
        Assert.expect(_token1).toEqualAddress(token1Address);
    });

    const MINIMUM_LIQUIDITY = 1000n;
    await vm.it('should mint liquidity', async () => {
        const amountTokenA: bigint = Blockchain.expandToDecimal(1, token0.decimals);
        const amountTokenB: bigint = Blockchain.expandToDecimal(4, token1.decimals);

        await token0.transfer(receiver, pool.address, amountTokenA);
        await token1.transfer(receiver, pool.address, amountTokenB);

        const expectedLiquidity: bigint = Blockchain.expandToDecimal(
            2,
            Math.min(token0.decimals, token1.decimals),
        );

        const mint: CallResponse = await pool.mintPool(receiver);
        if (!mint.response) throw new Error('Response not found');

        const reader = new BinaryReader(mint.response);
        const liquidity: bigint = reader.readU256();

        Assert.expect(liquidity).toEqual(expectedLiquidity - MINIMUM_LIQUIDITY);

        const transferAEvent = mint.events.shift();
        const transferBEvent = mint.events.shift();
        const syncEvent = mint.events.shift();
        const mintEvent = mint.events.shift();

        Assert.expect(transferAEvent).toBeDefined();
        Assert.expect(transferBEvent).toBeDefined();
        Assert.expect(syncEvent).toBeDefined();
        Assert.expect(mintEvent).toBeDefined();

        if (!transferAEvent || !transferBEvent || !syncEvent || !mintEvent) {
            throw new Error('Events not found');
        }

        Assert.expect(transferAEvent.type).toEqual('Mint');
        Assert.expect(transferBEvent.type).toEqual('Mint');
        Assert.expect(syncEvent.type).toEqual('Sync');
        Assert.expect(mintEvent.type).toEqual('PoolMint');

        const decodedTransferAEvent = OP_20.decodeMintEvent(transferAEvent.data);
        const decodedTransferBEvent = OP_20.decodeMintEvent(transferBEvent.data);

        Assert.expect(decodedTransferAEvent.to).toEqualAddress(Blockchain.DEAD_ADDRESS);
        Assert.expect(decodedTransferAEvent.value).toEqual(MINIMUM_LIQUIDITY);

        Assert.expect(decodedTransferBEvent.to).toEqualAddress(receiver);
        Assert.expect(decodedTransferBEvent.value).toEqual(expectedLiquidity - MINIMUM_LIQUIDITY);

        const decodedSyncEvent = MotoswapPool.decodeSyncEvent(syncEvent.data);
        Assert.expect(decodedSyncEvent.reserve0).toEqual(amountTokenA);
        Assert.expect(decodedSyncEvent.reserve1).toEqual(amountTokenB);

        const poolMintEvent = MotoswapPool.decodePoolMintEvent(mintEvent.data);
        Assert.expect(poolMintEvent.to).toEqualAddress(Blockchain.msgSender);
        Assert.expect(poolMintEvent.amount0).toEqual(amountTokenA);
        Assert.expect(poolMintEvent.amount1).toEqual(amountTokenB);

        const totalSupply = await pool.totalSupply();
        Assert.expect(totalSupply).toEqual(expectedLiquidity);

        const balanceOfWallet = await pool.balanceOf(receiver);
        const token0BalanceOfPool = await token0.balanceOf(pool.address);
        const token1BalanceOfPool = await token1.balanceOf(pool.address);

        Assert.expect(balanceOfWallet).toEqual(expectedLiquidity - MINIMUM_LIQUIDITY);
        Assert.expect(token0BalanceOfPool).toEqual(amountTokenA);
        Assert.expect(token1BalanceOfPool).toEqual(amountTokenB);

        const reserves = await pool.getReserves();
        Assert.expect(reserves.reserve0).toEqual(amountTokenA);
        Assert.expect(reserves.reserve1).toEqual(amountTokenB);
    });

    /** Motoswap: K */

    async function addLiquidity(token0Amount: bigint, token1Amount: bigint) {
        await pool.resetStates();

        await mintTokens();

        await token0.transfer(receiver, pool.address, token0Amount);
        await token1.transfer(receiver, pool.address, token1Amount);
        await pool.mintPool(Blockchain.txOrigin);
    }

    const swapTestCases: bigint[][] = [
        [1, 5, 10, 1662497915624478906n],
        [1, 10, 5, 453305446940074565n],

        [2, 5, 10, 2851015155847869602n],
        [2, 10, 5, 831248957812239453n],

        [1, 10, 10, 906610893880149131n],
        [1, 100, 100, 987158034397061298n],
        [1, 1000, 1000, 996006981039903216n],
    ].map((a) => a.map((n) => (typeof n === 'bigint' ? n : Blockchain.expandTo18Decimals(n))));

    await vm.it(`should get input price`, async () => {
        for (const swapTestCase of swapTestCases) {
            vm.debugBright(`Swap test case: ${swapTestCase}`);

            const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase;

            await addLiquidity(token0Amount, token1Amount);
            await token0.transfer(receiver, pool.address, swapAmount);
            Blockchain.backup();

            await Assert.expect(async () => {
                await pool.swap(0n, expectedOutputAmount + 1n, receiver, new Uint8Array());
            }).toThrow('Motoswap: K');
            Blockchain.restore();

            const start = Date.now();
            const swap = await pool.swap(0n, expectedOutputAmount, receiver, new Uint8Array());
            const end = Date.now();

            Blockchain.restore();

            vm.success(
                `✔️ Swap test case (${swapAmount}, ${token0Amount}, ${token1Amount}) passed in ${end - start}ms (${swap.usedGas} gas used)`,
            );
        }
    });

    await vm.it('should swap token0', async () => {
        const token0Amount = Blockchain.expandTo18Decimals(5);
        const token1Amount = Blockchain.expandTo18Decimals(10);

        await addLiquidity(token0Amount, token1Amount);

        const swapAmount = Blockchain.expandTo18Decimals(1);
        const expectedOutputAmount = 1662497915624478906n;

        await token0.transfer(receiver, pool.address, swapAmount);

        const swap: CallResponse = await pool.swap(
            0n,
            expectedOutputAmount,
            receiver,
            new Uint8Array(),
        );

        const transferEvent = swap.events.shift();
        const syncEvent = swap.events.shift();
        const swapEvent = swap.events.shift();

        if (!transferEvent || !syncEvent || !swapEvent) {
            throw new Error('Events not found');
        }

        // Event type check
        Assert.expect(transferEvent.type).toEqual('Transfer');
        Assert.expect(syncEvent.type).toEqual('Sync');
        Assert.expect(swapEvent.type).toEqual('Swap');

        // Transfer event check
        const decodedTransferEvent = OP_20.decodeTransferEvent(transferEvent.data);
        Assert.expect(decodedTransferEvent.from).toEqualAddress(pool.address);
        Assert.expect(decodedTransferEvent.to).toEqualAddress(receiver);
        Assert.expect(decodedTransferEvent.value).toEqual(expectedOutputAmount);

        // Sync event check
        const decodedSyncEvent = MotoswapPool.decodeSyncEvent(syncEvent.data);
        Assert.expect(decodedSyncEvent.reserve0).toEqual(token0Amount + swapAmount);
        Assert.expect(decodedSyncEvent.reserve1).toEqual(token1Amount - expectedOutputAmount);

        // Swap event check
        const decodedSwapEvent = MotoswapPool.decodeSwapEvent(swapEvent.data);
        Assert.expect(decodedSwapEvent.sender).toEqualAddress(Blockchain.msgSender);
        Assert.expect(decodedSwapEvent.amount0In).toEqual(swapAmount);
        Assert.expect(decodedSwapEvent.amount1In).toEqual(0n);
        Assert.expect(decodedSwapEvent.amount0Out).toEqual(0n);
        Assert.expect(decodedSwapEvent.amount1Out).toEqual(expectedOutputAmount);
        Assert.expect(decodedSwapEvent.to).toEqualAddress(receiver);

        // Reserve check
        const reserves = await pool.getReserves();
        Assert.expect(reserves.reserve0).toEqual(token0Amount + swapAmount);
        Assert.expect(reserves.reserve1).toEqual(token1Amount - expectedOutputAmount);

        // Pool balance check
        const poolToken0Balance = await token0.balanceOf(pool.address);
        const poolToken1Balance = await token1.balanceOf(pool.address);

        Assert.expect(poolToken0Balance).toEqual(token0Amount + swapAmount);
        Assert.expect(poolToken1Balance).toEqual(token1Amount - expectedOutputAmount);

        // Wallet balance check
        const totalSupplyToken0 = await token0.totalSupply();
        const totalSupplyToken1 = await token1.totalSupply();

        const balanceWalletToken0 = await token0.balanceOf(receiver);
        const balanceWalletToken1 = await token1.balanceOf(receiver);

        Assert.expect(balanceWalletToken0).toEqual(totalSupplyToken0 - token0Amount - swapAmount);
        Assert.expect(balanceWalletToken1).toEqual(
            totalSupplyToken1 - token1Amount + expectedOutputAmount,
        );
    });

    await vm.it('should swap token1', async () => {
        const token0Amount = Blockchain.expandTo18Decimals(5);
        const token1Amount = Blockchain.expandTo18Decimals(10);

        await addLiquidity(token0Amount, token1Amount);

        const swapAmount = Blockchain.expandTo18Decimals(1);
        const expectedOutputAmount = 453305446940074565n;

        await token1.transfer(receiver, pool.address, swapAmount);

        const swap: CallResponse = await pool.swap(
            expectedOutputAmount,
            0n,
            receiver,
            new Uint8Array(),
        );

        const transferEvent = swap.events.shift();
        const syncEvent = swap.events.shift();
        const swapEvent = swap.events.shift();

        if (!transferEvent || !syncEvent || !swapEvent) {
            throw new Error('Events not found');
        }

        // Event type check
        Assert.expect(transferEvent.type).toEqual('Transfer');
        Assert.expect(syncEvent.type).toEqual('Sync');
        Assert.expect(swapEvent.type).toEqual('Swap');

        // Transfer event check
        const decodedTransferEvent = OP_20.decodeTransferEvent(transferEvent.data);
        Assert.expect(decodedTransferEvent.from).toEqualAddress(pool.address);
        Assert.expect(decodedTransferEvent.to).toEqualAddress(receiver);
        Assert.expect(decodedTransferEvent.value).toEqual(expectedOutputAmount);

        // Sync event check
        const decodedSyncEvent = MotoswapPool.decodeSyncEvent(syncEvent.data);
        Assert.expect(decodedSyncEvent.reserve0).toEqual(token0Amount - expectedOutputAmount);
        Assert.expect(decodedSyncEvent.reserve1).toEqual(token1Amount + swapAmount);

        // Swap event check
        const decodedSwapEvent = MotoswapPool.decodeSwapEvent(swapEvent.data);
        Assert.expect(decodedSwapEvent.sender).toEqualAddress(Blockchain.msgSender);
        Assert.expect(decodedSwapEvent.amount0In).toEqual(0n);
        Assert.expect(decodedSwapEvent.amount1In).toEqual(swapAmount);
        Assert.expect(decodedSwapEvent.amount0Out).toEqual(expectedOutputAmount);
        Assert.expect(decodedSwapEvent.amount1Out).toEqual(0n);
        Assert.expect(decodedSwapEvent.to).toEqualAddress(receiver);

        // Reserve check
        const reserves = await pool.getReserves();
        Assert.expect(reserves.reserve0).toEqual(token0Amount - expectedOutputAmount);
        Assert.expect(reserves.reserve1).toEqual(token1Amount + swapAmount);

        // Pool balance check
        const poolToken0Balance = await token0.balanceOf(pool.address);
        const poolToken1Balance = await token1.balanceOf(pool.address);
        Assert.expect(poolToken0Balance).toEqual(token0Amount - expectedOutputAmount);
        Assert.expect(poolToken1Balance).toEqual(token1Amount + swapAmount);

        // Wallet balance check
        const totalSupplyToken0 = await token0.totalSupply();
        const totalSupplyToken1 = await token1.totalSupply();

        const balanceWalletToken0 = await token0.balanceOf(receiver);
        const balanceWalletToken1 = await token1.balanceOf(receiver);
        Assert.expect(balanceWalletToken0).toEqual(
            totalSupplyToken0 - token0Amount + expectedOutputAmount,
        );
        Assert.expect(balanceWalletToken1).toEqual(totalSupplyToken1 - token1Amount - swapAmount);
    });

    await vm.it(`should burn liquidity`, async () => {
        const token0Amount = Blockchain.expandTo18Decimals(3);
        const token1Amount = Blockchain.expandTo18Decimals(3);

        await addLiquidity(token0Amount, token1Amount);

        const expectedLiquidity = Blockchain.expandTo18Decimals(3);
        await pool.transfer(receiver, pool.address, expectedLiquidity - MINIMUM_LIQUIDITY);

        const burn: CallResponse = await pool.burnLiquidity(receiver);
        if (!burn.response) {
            throw new Error('Response not found');
        }

        const burnAEvent = burn.events.shift();
        const transferAEvent = burn.events.shift();
        const transferBEvent = burn.events.shift();
        const syncEvent = burn.events.shift();
        const burnEvent = burn.events.shift();

        if (!transferAEvent || !transferBEvent || !burnAEvent || !syncEvent || !burnEvent) {
            throw new Error('Events not found');
        }

        const readerBurn = new BinaryReader(burn.response);
        const amount0 = readerBurn.readU256();
        const amount1 = readerBurn.readU256();

        vm.log(`Amount0: ${amount0} - Amount1: ${amount1}`);

        // Event type check
        Assert.expect(transferAEvent.type).toEqual('Transfer');
        Assert.expect(transferBEvent.type).toEqual('Transfer');
        Assert.expect(burnAEvent.type).toEqual('Burn');
        Assert.expect(syncEvent.type).toEqual('Sync');
        Assert.expect(burnEvent.type).toEqual('PoolBurn');

        // Transfer event check
        const decodedTransferAEvent = OP_20.decodeTransferEvent(transferAEvent.data);
        Assert.expect(decodedTransferAEvent.from).toEqualAddress(pool.address);
        Assert.expect(decodedTransferAEvent.to).toEqualAddress(receiver);
        Assert.expect(decodedTransferAEvent.value).toEqual(token0Amount - 1000n);

        const decodedTransferBEvent = OP_20.decodeTransferEvent(transferBEvent.data);
        Assert.expect(decodedTransferBEvent.from).toEqualAddress(pool.address);
        Assert.expect(decodedTransferBEvent.to).toEqualAddress(receiver);
        Assert.expect(decodedTransferBEvent.value).toEqual(token1Amount - 1000n);

        const decodedTransferCEvent = OP_20.decodeBurnEvent(burnAEvent.data);
        Assert.expect(decodedTransferCEvent.value).toEqual(token0Amount - MINIMUM_LIQUIDITY);

        // Sync event check
        const decodedSyncEvent = MotoswapPool.decodeSyncEvent(syncEvent.data);
        Assert.expect(decodedSyncEvent.reserve0).toEqual(1000n);
        Assert.expect(decodedSyncEvent.reserve1).toEqual(1000n);

        // Burn event check
        const decodedBurnEvent = MotoswapPool.decodePoolBurnEvent(burnEvent.data);
        Assert.expect(decodedBurnEvent.sender).toEqualAddress(Blockchain.msgSender);
        Assert.expect(decodedBurnEvent.amount0).toEqual(token0Amount - 1000n);
        Assert.expect(decodedBurnEvent.amount1).toEqual(token1Amount - 1000n);

        // Pool balance check
        const poolBalance = await pool.balanceOf(receiver);
        Assert.expect(poolBalance).toEqual(0n);

        // Total supply check
        const totalSupplyPool = await pool.totalSupply();
        Assert.expect(totalSupplyPool).toEqual(MINIMUM_LIQUIDITY);

        // Pool token balance check
        const poolToken0Balance = await token0.balanceOf(pool.address);
        const poolToken1Balance = await token1.balanceOf(pool.address);

        Assert.expect(poolToken0Balance).toEqual(1000n);
        Assert.expect(poolToken1Balance).toEqual(1000n);

        // Wallet balance check
        const totalSupplyToken0 = await token0.totalSupply();
        const totalSupplyToken1 = await token1.totalSupply();

        const balanceWalletToken0 = await token0.balanceOf(receiver);
        const balanceWalletToken1 = await token1.balanceOf(receiver);

        Assert.expect(balanceWalletToken0).toEqual(totalSupplyToken0 - 1000n);
        Assert.expect(balanceWalletToken1).toEqual(totalSupplyToken1 - 1000n);
    });

    await vm.it(`should have valid price{0,1}CumulativeLast`, async () => {
        const token0Amount = Blockchain.expandTo18Decimals(3);
        const token1Amount = Blockchain.expandTo18Decimals(3);

        await addLiquidity(token0Amount, token1Amount);

        const reserves = await pool.getReserves();
        const blockTimestampLast = reserves.blockTimestampLast;

        Blockchain.mineBlock();

        await pool.sync();

        const initialPrice = Blockchain.encodePrice(token0Amount, token1Amount);
        const cumulativePrice0Last = await pool.price0CumulativeLast();
        const cumulativePrice1Last = await pool.price1CumulativeLast();

        Assert.expect(cumulativePrice0Last).toEqual(initialPrice[0]);
        Assert.expect(cumulativePrice1Last).toEqual(initialPrice[1]);

        const reservesAfterSync = await pool.getReserves();
        const blockTimestampLastAfterSync = reservesAfterSync.blockTimestampLast;

        Assert.expect(blockTimestampLastAfterSync).toEqual(blockTimestampLast + 1n);

        const swapAmount = Blockchain.expandTo18Decimals(3);
        await token0.transfer(receiver, pool.address, swapAmount);

        // mine 9 more blocks
        for (let i = 0; i < 9; i++) {
            Blockchain.mineBlock();
        }

        await pool.swap(0n, Blockchain.expandTo18Decimals(1), receiver, new Uint8Array());

        const cumulativePrice0LastAfterSwap = await pool.price0CumulativeLast();
        const cumulativePrice1LastAfterSwap = await pool.price1CumulativeLast();

        Assert.expect(cumulativePrice0LastAfterSwap).toEqual(initialPrice[0] * 10n);
        Assert.expect(cumulativePrice1LastAfterSwap).toEqual(initialPrice[1] * 10n);

        const reservesAfterSwap = await pool.getReserves();
        const blockTimestampLastAfterSwap = reservesAfterSwap.blockTimestampLast;

        Assert.expect(blockTimestampLastAfterSwap).toEqual(blockTimestampLast + 10n);

        // mine 10 more blocks
        for (let i = 0; i < 10; i++) {
            Blockchain.mineBlock();
        }

        await pool.sync();

        const newPrice = Blockchain.encodePrice(
            Blockchain.expandTo18Decimals(6),
            Blockchain.expandTo18Decimals(2),
        );

        const cumulativePrice0LastAfterSync = await pool.price0CumulativeLast();
        const cumulativePrice1LastAfterSync = await pool.price1CumulativeLast();

        Assert.expect(cumulativePrice0LastAfterSync).toEqual(
            initialPrice[0] * 10n + newPrice[0] * 10n,
        );
        Assert.expect(cumulativePrice1LastAfterSync).toEqual(
            initialPrice[1] * 10n + newPrice[1] * 10n,
        );

        const reservesAfterSync2 = await pool.getReserves();
        const blockTimestampLastAfterSync2 = reservesAfterSync2.blockTimestampLast;

        Assert.expect(blockTimestampLastAfterSync2).toEqual(blockTimestampLast + 20n);
    });

    await vm.it(`feeTo:off`, async () => {
        const token0Amount = Blockchain.expandTo18Decimals(1000);
        const token1Amount = Blockchain.expandTo18Decimals(1000);

        await addLiquidity(token0Amount, token1Amount);

        const swapAmount = Blockchain.expandTo18Decimals(1);
        const expectedOutputAmount = 996006981039903216n;

        await token1.transfer(receiver, pool.address, swapAmount);

        await pool.swap(expectedOutputAmount, 0n, receiver, new Uint8Array());

        const expectedLiquidity = Blockchain.expandTo18Decimals(1000);
        await pool.transfer(receiver, pool.address, expectedLiquidity - MINIMUM_LIQUIDITY);
        await pool.burnLiquidity(receiver);

        const totalSupply = await pool.totalSupply();
        Assert.expect(totalSupply).toEqual(MINIMUM_LIQUIDITY);
    });

    /*await vm.it(`feeTo:on`, async () => {
        const token0Amount = Blockchain.expandTo18Decimals(1000);
        const token1Amount = Blockchain.expandTo18Decimals(1000);

        await addLiquidity(token0Amount, token1Amount);

        await pool.setFeeTo(receiver);

        const swapAmount = Blockchain.expandTo18Decimals(1);
        const expectedOutputAmount = 996006981039903216n;

        await token1.transfer(receiver, pool.address, swapAmount);

        await pool.swap(expectedOutputAmount, 0n, receiver, new Uint8Array());

        const expectedLiquidity = Blockchain.expandTo18Decimals(1000);
        await pool.transfer(receiver, pool.address, expectedLiquidity - MINIMUM_LIQUIDITY);
        await pool.burnLiquidity(receiver);

        const totalSupply = await pool.totalSupply();
        Assert.expect(totalSupply).toEqual(MINIMUM_LIQUIDITY);#
    });*/

    Blockchain.dispose();
});
