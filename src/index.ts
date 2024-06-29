import fs from 'fs';
import bitcoin from 'bitcoinjs-lib';
import { opnet, OPNetUnit } from './unit/OPNetUnit.js';
import { Factory } from './tests/Factory.js';
import { Assert } from './unit/Assert.js';

const bytecode = fs.readFileSync('./bytecode/factory.wasm');
const pool = fs.readFileSync('./bytecode/pool.wasm');

const poolBytecodeHash = bitcoin.crypto.hash256(pool);
console.log('Pool bytecode hash:', poolBytecodeHash.toString('hex'), Array.from(poolBytecodeHash));

opnet('Motoswap factory', async (vm: OPNetUnit) => {
    await vm.it('should instantiate the factory', async () => {
        await Assert.expect(async () => {
            const factory = new Factory(bytecode);
            await factory.init();
            factory.dispose();
        }).toNotThrow();
    });

    let factory: Factory = new Factory(bytecode);
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
