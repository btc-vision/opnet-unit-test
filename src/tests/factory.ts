import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { MotoswapFactory } from '../contracts/MotoswapFactory.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { MotoswapPool } from '../contracts/MotoswapPool.js';
import { Address } from '@btc-vision/bsi-binary';

await opnet('Motoswap Factory', async (vm: OPNetUnit) => {
    await vm.it('should instantiate the factory', async () => {
        await Assert.expect(async () => {
            const factory = new MotoswapFactory();
            await factory.init();
            factory.dispose();
        }).toNotThrow();
    });

    const token0: Address = Blockchain.generateRandomSegwitAddress();
    const token1: Address = Blockchain.generateRandomSegwitAddress();

    // Declare all the request contracts
    let factory: MotoswapFactory = new MotoswapFactory();
    let pool: MotoswapPool = new MotoswapPool(token0, token1);
    Blockchain.register(pool);
    Blockchain.register(factory);

    vm.beforeEach(async () => {
        await Blockchain.init();
    });

    vm.afterAll(async () => {
        Blockchain.dispose();
    });

    await vm.it('should create a pool', async () => {
        await factory.createPool();

        console.log('States:', factory.getStates());
    });
});
