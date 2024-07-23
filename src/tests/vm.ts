import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { OP_20 } from '../contracts/OP_20.js';
import { Address } from '@btc-vision/bsi-binary';
import { Blockchain } from '../blockchain/Blockchain.js';
import { Assert } from '../opnet/unit/Assert.js';
import fs from 'fs';
import { BitcoinNetworkRequest, Contract } from '@btc-vision/bsi-wasmer-vm';

await opnet('VM', async (vm: OPNetUnit) => {
    /*await vm.it('should clear every contracts without hanging.', async () => {
        const fake: Address = Blockchain.generateRandomSegwitAddress();
        const toInstantiate: number = 200;

        const promises: Promise<void>[] = [];
        const contracts: OP_20[] = [];

        for (let i = 0; i < toInstantiate; i++) {
            const contract = new OP_20(`MyToken`, fake, 18);

            contracts.push(contract);
            promises.push(contract.init());
        }

        await Promise.all(promises);

        // Try to dispose all contracts
        for (let contract of contracts) {
            global.gc();
            contract.delete();
        }

        Assert.equal(contracts.length, toInstantiate);
    });*/

    await vm.it('should clear every contracts without hanging.', async () => {
        const fake: Address = Blockchain.generateRandomSegwitAddress();
        const toInstantiate: number = 2000;

        const promises: Promise<void>[] = [];
        const contracts: OP_20[] = [];

        const bytecode = fs.readFileSync('./bytecode/MyToken.wasm');

        for (let i = 0; i < toInstantiate; i++) {
            new Contract(
                bytecode,
                30000000n,
                BitcoinNetworkRequest.Regtest,
                function () {
                    throw new Error(`a`);
                },
                function () {
                    throw new Error(`a`);
                },
                function () {
                    throw new Error(`a`);
                },
                function () {
                    throw new Error(`a`);
                },
                function () {
                    throw new Error(`a`);
                },
            );

            //promises.push(contract.init());
        }

        //await Promise.all(promises);

        Assert.equal(contracts.length, toInstantiate);
    });

    await vm.it('should clear every contracts without hanging.', async () => {
        console.log(Blockchain);

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve();
            }, 10000);
        });
    });
});
