import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { Address } from '@btc-vision/bsi-binary';
import { MotoswapRouter } from '../contracts/MotoswapRouter.js';
import { OP_20 } from '../contracts/OP_20.js';
import { AddLiquidityParameters } from '../interfaces/RouterInterfaces.js';
import { MotoswapFactory } from '../contracts/MotoswapFactory.js';
import { MotoswapPool } from '../contracts/MotoswapPool.js';
import { WBTC_ADDRESS } from '../contracts/configs.js';

await opnet('Motoswap Router', async (vm: OPNetUnit) => {
    const dttAddress: Address = Blockchain.generateRandomSegwitAddress();
    const receiver: Address = Blockchain.generateRandomTaprootAddress();

    await vm.it('should init the router', async () => {
        await Assert.expect(async () => {
            const router = new MotoswapRouter();
            await router.init();
            router.dispose();
        }).toNotThrow();
    });

    Blockchain.caller = receiver;
    Blockchain.callee = receiver;

    let factory: MotoswapFactory;
    let pool: MotoswapPool;
    let DTT: OP_20;
    let wbtc: OP_20;
    let router: MotoswapRouter;

    async function mintTokens() {
        await DTT.resetStates();
        await wbtc.resetStates();

        let amountA = 11000000;
        let amountB = 11000000;

        // Mint some token
        await DTT.mint(receiver, amountA);
        await wbtc.mint(receiver, amountB);

        const currentBalanceTokenA = await DTT.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenA).toEqual(amountA);

        const currentBalanceTokenB = await wbtc.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenB).toEqual(amountB);
    }

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
        wbtc = new OP_20('MyToken', WBTC_ADDRESS, 8);
        Blockchain.register(DTT);
        Blockchain.register(wbtc);

        // Declare all the request contracts
        router = new MotoswapRouter();
        Blockchain.register(router);

        await Blockchain.init();
    });

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

    vm.afterEach(async () => {
        const wbtcBalanceOfRouter = await wbtc.balanceOf(router.address);
        dispose();

        Assert.expect(wbtcBalanceOfRouter).toEqual(0n);
    });

    vm.afterAll(async () => {
        dispose();
    });

    /*async function addLiquidity(dttAmount: bigint, wbtcAmount: bigint): Promise<void> {
        const addLiquidityParameters: AddLiquidityParameters = {
            tokenA: wbtcAddress,
            tokenB: dttAddress,
            amountADesired: dttAmount,
            amountBDesired: wbtcAmount,
            amountAMin: 0n,
            amountBMin: 0n,
            to: receiver,
            deadline: 100n,
        };

        await router.addLiquidity(addLiquidityParameters);
    }*/

    /** TESTS */
    await vm.it('should add liquidity: INSUFFICIENT_LIQUIDITY_MINTED', async () => {
        await mintTokens();

        const amountA: bigint = 100n;
        const amountB: bigint = 100n;

        await DTT.approve(receiver, router.address, amountA);
        await wbtc.approve(receiver, router.address, amountB);

        const addLiquidityParameters: AddLiquidityParameters = {
            tokenA: WBTC_ADDRESS,
            tokenB: dttAddress,
            amountADesired: amountA,
            amountBDesired: amountB,
            amountAMin: 0n,
            amountBMin: 0n,
            to: receiver,
            deadline: 100n,
        };

        await Assert.expect(async () => {
            const addLiquidity = await router.addLiquidity(addLiquidityParameters);

            console.log(addLiquidity);
        }).toThrow('INSUFFICIENT_LIQUIDITY_MINTED');
    });

    await vm.it(
        'should add liquidity: create pool if the pool does not exist and add liquidity.',
        async () => {
            await mintTokens();

            const amountA: bigint = 100000n;
            const amountB: bigint = 100000n;

            await DTT.approve(receiver, router.address, amountA);
            await wbtc.approve(receiver, router.address, amountB);

            const addLiquidityParameters: AddLiquidityParameters = {
                tokenA: WBTC_ADDRESS,
                tokenB: dttAddress,
                amountADesired: amountA,
                amountBDesired: amountB,
                amountAMin: 0n,
                amountBMin: 0n,
                to: receiver,
                deadline: 100n,
            };

            const addLiquidity = await router.addLiquidity(addLiquidityParameters);

            console.log(addLiquidity);
        },
    );
});
