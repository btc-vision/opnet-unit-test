import { MotoswapFactory } from '../../contracts/motoswap/MotoswapFactory.js';
import { MotoswapPool } from '../../contracts/motoswap/MotoswapPool.js';
import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { MOTO_ADDRESS, WBTC_ADDRESS } from '../../common.js';

await opnet('Motoswap Factory', async (vm: OPNetUnit) => {
    const receiver: Address = Blockchain.generateRandomAddress();
    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    await vm.it('should instantiate the factory', async () => {
        await Assert.expect(async () => {
            const factory = new MotoswapFactory(Blockchain.txOrigin);
            await factory.init();
            factory.dispose();
        }).toNotThrow();
    });

    // Declare all the request contracts
    const factory: MotoswapFactory = new MotoswapFactory(Blockchain.txOrigin);
    const pool: MotoswapPool = new MotoswapPool(WBTC_ADDRESS, MOTO_ADDRESS);

    Blockchain.register(pool);
    Blockchain.register(factory);

    vm.beforeEach(async () => {
        await Blockchain.init();
    });

    vm.afterAll(() => {
        Blockchain.dispose();
    });

    await vm.it('should create a pool', async () => {
        await factory.createPool(WBTC_ADDRESS, MOTO_ADDRESS);

        console.log('States:', factory.getStates(), factory.getDeploymentStates());
    });
});
