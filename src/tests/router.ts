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
    const wbtcAddress: Address = Blockchain.generateRandomSegwitAddress();
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

    /** Init factory */
    const factory: MotoswapFactory = new MotoswapFactory();
    Blockchain.register(factory);

    /** Init template pool */
    const pool: MotoswapPool = new MotoswapPool(dttAddress, wbtcAddress);
    Blockchain.register(pool);

    /** Init OP_20 */
    const DTT: OP_20 = new OP_20('MyToken', dttAddress, 18);
    const wbtc: OP_20 = new OP_20('wbtc', WBTC_ADDRESS, 8);
    Blockchain.register(DTT);
    Blockchain.register(wbtc);

    // Declare all the request contracts
    const router: MotoswapRouter = new MotoswapRouter();
    Blockchain.register(router);

    vm.beforeEach(async () => {
        await Blockchain.init();
    });

    vm.afterAll(async () => {
        Blockchain.dispose();
    });

    vm.afterEach(async () => {
        const wbtcBalanceOfRouter = await wbtc.balanceOf(router.address);

        Assert.expect(wbtcBalanceOfRouter).toEqual(0n);
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
    await vm.it('should add liquidity: create pool if the pool does not exist.', async () => {
        const addLiquidityParameters: AddLiquidityParameters = {
            tokenA: wbtcAddress,
            tokenB: dttAddress,
            amountADesired: 100n,
            amountBDesired: 100n,
            amountAMin: 0n,
            amountBMin: 0n,
            to: receiver,
            deadline: 100n,
        };

        const addLiquidity = await router.addLiquidity(addLiquidityParameters);

        console.log(addLiquidity);
    });
});
