import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { Address } from '@btc-vision/bsi-binary';
import { MotoswapRouter } from '../contracts/MotoswapRouter.js';
import { OP_20 } from '../contracts/OP_20.js';
import { AddLiquidityParameters } from '../interfaces/RouterInterfaces.js';
import { MotoswapFactory } from '../contracts/MotoswapFactory.js';
import { MotoswapPool, Reserves } from '../contracts/MotoswapPool.js';
import { WBTC_ADDRESS } from '../contracts/configs.js';

const MaxUint256: bigint = 2n ** 256n - 1n;
const dttAddress: Address = Blockchain.generateRandomSegwitAddress();
const receiver: Address = Blockchain.generateRandomTaprootAddress();
const MINIMUM_LIQUIDITY = 1000n;

Blockchain.caller = receiver;
Blockchain.callee = receiver;

let factory: MotoswapFactory;
let pool: MotoswapPool;
let DTT: OP_20;
let wbtc: OP_20;
let router: MotoswapRouter;

async function mintTokens(amountA: number = 11000000, amountB: number = 11000000) {
    await DTT.resetStates();
    await wbtc.resetStates();

    // Mint some token
    await DTT.mint(receiver, amountA);
    await wbtc.mint(receiver, amountB);

    const currentBalanceTokenA = await DTT.balanceOfNoDecimals(receiver);
    Assert.expect(currentBalanceTokenA).toEqual(amountA);

    const currentBalanceTokenB = await wbtc.balanceOfNoDecimals(receiver);
    Assert.expect(currentBalanceTokenB).toEqual(amountB);
}

function sortTokens(tokenA: Address, tokenB: Address): Address[] {
    if (tokenA < tokenB) {
        return [tokenA, tokenB];
    } else {
        return [tokenB, tokenA];
    }
}

function getReserves(
    tokenA: Address,
    tokenB: Address,
    reserve0: bigint,
    reserve1: bigint,
): Reserves {
    const [token0, token1] = sortTokens(tokenA, tokenB);

    return {
        reserve0: token0 === tokenA ? reserve0 : reserve1,
        reserve1: token0 === tokenA ? reserve1 : reserve0,
        blockTimestampLast: 0n,
    };
}

function dispose() {
    Blockchain.dispose();
    Blockchain.clearContracts();

    if (factory) {
        factory.dispose();
    }

    if (pool) {
        pool.dispose();
    }

    if (DTT) {
        DTT.dispose();
    }

    if (wbtc) {
        wbtc.dispose();
    }

    if (router) {
        router.dispose();
    }
}

async function approveTokens(wbtcAmount: bigint, dttAmount: bigint): Promise<void> {
    await mintTokens();

    await DTT.approve(receiver, router.address, dttAmount);
    await wbtc.approve(receiver, router.address, wbtcAmount);
}

async function addLiquidity(DTTAmount: bigint, WBTCAmount: bigint) {
    await approveTokens(DTTAmount, WBTCAmount);

    const addLiquidityParameters: AddLiquidityParameters = {
        tokenA: WBTC_ADDRESS,
        tokenB: dttAddress,
        amountADesired: DTTAmount,
        amountBDesired: WBTCAmount,
        amountAMin: DTTAmount,
        amountBMin: WBTCAmount,
        to: receiver,
        deadline: 2n,
    };

    await router.addLiquidity(addLiquidityParameters);
}

await opnet('Motoswap Router', async (vm: OPNetUnit) => {
    vm.beforeEach(async () => {
        Blockchain.dispose();

        /** Init factory */
        factory = new MotoswapFactory();
        Blockchain.register(factory);

        /** Init template pool */
        pool = new MotoswapPool(dttAddress, WBTC_ADDRESS);
        Blockchain.register(pool);

        /** Init OP_20 */
        DTT = new OP_20('MyToken', dttAddress, 18);
        wbtc = new OP_20('MyToken', WBTC_ADDRESS, 18);
        Blockchain.register(DTT);
        Blockchain.register(wbtc);

        // Declare all the request contracts
        router = new MotoswapRouter();
        Blockchain.register(router);

        await Blockchain.init();
    });

    vm.afterEach(async () => {
        const wbtcBalanceOfRouter = await wbtc.balanceOf(router.address);
        dispose();

        Assert.expect(wbtcBalanceOfRouter).toEqual(0n);
    });

    vm.afterAll(async () => {
        dispose();
    });

    /** TESTS */
    await vm.it(
        `verify that the factory address is valid and the WBTC address is valid`,
        async () => {
            const factoryAddress = await router.getFactory();
            const WBTCAddress = await router.getWBTC();

            Assert.expect(factoryAddress).toEqual(factory.address);
            Assert.expect(WBTCAddress).toEqual(WBTC_ADDRESS);
        },
    );

    await vm.it(`addLiquidity`, async () => {
        const token0Amount: bigint = Blockchain.expandTo18Decimals(1);
        const token1Amount: bigint = Blockchain.expandTo18Decimals(4);
        const expectedLiquidity: bigint = Blockchain.expandTo18Decimals(2);

        await approveTokens(token0Amount, token1Amount);

        const addLiquidityParameters: AddLiquidityParameters = {
            tokenA: WBTC_ADDRESS,
            tokenB: dttAddress,
            amountADesired: token0Amount,
            amountBDesired: token1Amount,
            amountAMin: 0n,
            amountBMin: 0n,
            to: receiver,
            deadline: 100n,
        };

        const addLiquidity = await router.addLiquidity(addLiquidityParameters);

        const poolCreationEvent = addLiquidity.events[0];
        const transferEventA = addLiquidity.events[1];
        const transferEventB = addLiquidity.events[2];
        const mintEvent = addLiquidity.events[3];
        const mintBEvent = addLiquidity.events[4];
        const syncEvent = addLiquidity.events[5];
        const poolMintEvent = addLiquidity.events[6];

        if (
            !poolCreationEvent ||
            !transferEventA ||
            !transferEventB ||
            !mintEvent ||
            !mintBEvent ||
            !syncEvent ||
            !poolMintEvent
        ) {
            throw new Error('Invalid events');
        }

        Assert.expect(poolCreationEvent.eventType).toEqual('PoolCreated');
        Assert.expect(transferEventA.eventType).toEqual('Transfer');
        Assert.expect(transferEventB.eventType).toEqual('Transfer');
        Assert.expect(mintEvent.eventType).toEqual('Mint');
        Assert.expect(mintBEvent.eventType).toEqual('Mint');
        Assert.expect(syncEvent.eventType).toEqual('Sync');
        Assert.expect(poolMintEvent.eventType).toEqual('PoolMint');

        // Decode first transfer event
        const poolCreatedEvent = MotoswapPool.decodeTransferEvent(transferEventA.eventData);
        Assert.expect(poolCreatedEvent.from).toEqual(receiver);
        Assert.expect(poolCreatedEvent.value).toEqual(token0Amount);

        // Decode second transfer event
        const poolCreatedEventB = MotoswapPool.decodeTransferEvent(transferEventB.eventData);
        Assert.expect(poolCreatedEventB.from).toEqual(receiver);
        Assert.expect(poolCreatedEventB.value).toEqual(token1Amount);

        // Decode mint event
        const mintedEvent = MotoswapPool.decodeMintEvent(mintEvent.eventData);
        Assert.expect(mintedEvent.to).toEqual('bc1dead');
        Assert.expect(mintedEvent.value).toEqual(MINIMUM_LIQUIDITY);

        // Decode mint event
        const mintedEventB = MotoswapPool.decodeMintEvent(mintBEvent.eventData);
        Assert.expect(mintedEventB.to).toEqual(receiver);
        Assert.expect(mintedEventB.value).toEqual(expectedLiquidity - MINIMUM_LIQUIDITY);

        const pair: MotoswapPool = MotoswapPool.createFromRuntime(
            Blockchain.getContract(poolCreatedEvent.to),
            WBTC_ADDRESS,
            dttAddress,
        );
        await pair.init();

        // Decode sync event
        const syncEventDecoded = MotoswapPool.decodeSyncEvent(syncEvent.eventData);
        const sortedReserves = getReserves(WBTC_ADDRESS, dttAddress, token0Amount, token1Amount);

        Assert.expect(syncEventDecoded.reserve0).toEqual(sortedReserves.reserve0);
        Assert.expect(syncEventDecoded.reserve1).toEqual(sortedReserves.reserve1);

        // Decode pool mint event
        const poolMintEventDecoded = MotoswapPool.decodePoolMintEvent(poolMintEvent.eventData);
        Assert.expect(poolMintEventDecoded.to).toEqual(receiver);

        Assert.expect(poolMintEventDecoded.amount0).toEqual(sortedReserves.reserve0); // token0Amount
        Assert.expect(poolMintEventDecoded.amount1).toEqual(sortedReserves.reserve1);

        const balanceOfReceiver = await pair.balanceOf(receiver);
        Assert.expect(balanceOfReceiver).toEqual(expectedLiquidity - MINIMUM_LIQUIDITY);

        pair.dispose();
    });
});
