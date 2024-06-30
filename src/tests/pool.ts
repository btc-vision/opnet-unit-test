import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { MotoswapPool } from '../contracts/MotoswapPool.js';
import { Address, BinaryReader } from '@btc-vision/bsi-binary';
import { OP_20 } from '../contracts/OP_20.js';
import { CallResponse } from '../opnet/modules/ContractRuntime.js';

await opnet('Motoswap Pool', async (vm: OPNetUnit) => {
    const token0Address: Address = Blockchain.generateRandomSegwitAddress();
    const token1Address: Address = Blockchain.generateRandomSegwitAddress();
    const receiver: Address = Blockchain.generateRandomTaprootAddress();

    await vm.it('should init a pool', async () => {
        await Assert.expect(async () => {
            const pool = new MotoswapPool(token0Address, token1Address);
            await pool.init();
            pool.dispose();
        }).toNotThrow();
    });

    Blockchain.caller = receiver;
    Blockchain.callee = receiver;

    /** Init OP_20 */
    const token0: OP_20 = new OP_20('wbtc', token0Address, 8);
    const token1: OP_20 = new OP_20('moto', token1Address, 8);
    Blockchain.register(token0);
    Blockchain.register(token1);

    // Declare all the request contracts
    const pool: MotoswapPool = new MotoswapPool(token0Address, token1Address);
    Blockchain.register(pool);

    vm.beforeEach(async () => {
        await Blockchain.init();
    });

    await vm.beforeAll(async () => {
        await Blockchain.init();

        let amountA = 11000000;
        let amountB = 11000000;

        // Mint some token
        await token0.mint(receiver, amountA);
        await token1.mint(receiver, amountB);

        const currentBalanceTokenA = await token0.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenA).toEqual(amountA);

        const currentBalanceTokenB = await token1.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenB).toEqual(amountB);

        vm.success('Minted tokens');
    });

    vm.afterAll(async () => {
        Blockchain.dispose();
    });

    /** TESTS */
    await vm.it('should instantiate a pool', async () => {
        await pool.initializePool();
    });

    await vm.it('should return the correct token0 and token1', async () => {
        const _token0: Address = await pool.getToken0();
        const _token1: Address = await pool.getToken1();

        Assert.expect(_token0).toEqual(token0Address);
        Assert.expect(_token1).toEqual(token1Address);
    });

    await vm.it('should mint liquidity', async () => {
        const MINIMUM_LIQUIDITY = 1000n;

        const amountTokenA: bigint = Blockchain.expandToDecimal(1, token0.decimals);
        const amountTokenB: bigint = Blockchain.expandToDecimal(4, token1.decimals);

        await token0.transfer(receiver, pool.address, amountTokenA);
        await token1.transfer(receiver, pool.address, amountTokenB);

        const expectedLiquidity: bigint = Blockchain.expandToDecimal(
            2,
            Math.min(token0.decimals, token1.decimals),
        );

        const mint: CallResponse = await pool.mintPool();
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

        Assert.expect(transferAEvent.eventType).toEqual('Mint');
        Assert.expect(transferBEvent.eventType).toEqual('Mint');
        Assert.expect(syncEvent.eventType).toEqual('Sync');
        Assert.expect(mintEvent.eventType).toEqual('PoolMint');

        const decodedTransferAEvent = OP_20.decodeMintEvent(transferAEvent.eventData);
        const decodedTransferBEvent = OP_20.decodeMintEvent(transferBEvent.eventData);

        Assert.expect(decodedTransferAEvent.to).toEqual(Blockchain.deadAddress);
        Assert.expect(decodedTransferAEvent.value).toEqual(MINIMUM_LIQUIDITY);

        Assert.expect(decodedTransferBEvent.to).toEqual(receiver);
        Assert.expect(decodedTransferBEvent.value).toEqual(expectedLiquidity - MINIMUM_LIQUIDITY);

        const decodedSyncEvent = MotoswapPool.decodeSyncEvent(syncEvent.eventData);
        Assert.expect(decodedSyncEvent.reserve0).toEqual(amountTokenA);
        Assert.expect(decodedSyncEvent.reserve1).toEqual(amountTokenB);

        const poolMintEvent = MotoswapPool.decodePoolMintEvent(mintEvent.eventData);
        Assert.expect(poolMintEvent.to).toEqual(receiver);
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

        console.log(pool);
    });
});
