import fs from 'fs';
import { opnet, OPNetUnit } from './unit/OPNetUnit.js';
import { MotoswapFactory } from './tests/MotoswapFactory.js';
import { Assert } from './unit/Assert.js';

const bytecode = fs.readFileSync('./bytecode/factory.wasm');

opnet('Motoswap Factory', async (vm: OPNetUnit) => {
    await vm.it('should instantiate the factory', async () => {
        await Assert.expect(async () => {
            const factory = new MotoswapFactory(bytecode);
            await factory.init();
            factory.dispose();
        }).toNotThrow();
    });

    let factory: MotoswapFactory = new MotoswapFactory(bytecode);
    vm.beforeEach(async () => {
        if (factory) {
            factory.dispose();
        }

        await factory.init();
    });

    vm.afterAll(async () => {
        vm.log('Cleaning up');
        factory.dispose();
    });

    await vm.it('should create a pool', async () => {
        await factory.createPool();
    });
});
