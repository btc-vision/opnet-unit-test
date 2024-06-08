import { Contract } from '@btc-vision/bsi-wasmer-vm';
import fs from "fs";
import { loadRust } from "./loaderv2.js";

const bytecode = fs.readFileSync('./bytecode/contract.wasm');
const address = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';
const deployer = 'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';

(async () => {
    let init = Date.now();

    try {
        /**
         * @type {import('@btc-vision/bsi-wasmer-vm').Contract}
         */

        for(let i = 0; i < 1; i++) {
            const contract = Contract.instanciate(bytecode, address, deployer);
            contract.init(address,deployer);

            //const contract = Contract.instanciate(bytecode, address, deployer);
            const rust = await loadRust(contract);

            const contractPointer = rust.getContract();
            const viewABI3 = rust.getMethodABI();
            const viewABI4 = rust.getViewABI();

            const calldata = Buffer.from('7462317076616a6476676873733074633733377a373273713032636761396864377776647561397663716a33353761367971686c687934736575643433390000', 'hex');
            const caller = 'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';

            let callTime = Date.now();
            const resp = rust.readMethod(0x82d62f3d, contractPointer, calldata, caller);
            console.log('resp', resp, `Took ${Date.now() - init}ms Call took ${Date.now() - callTime}ms`);

            const events = rust.getEvents();
            const getModifiedStorage = rust.getModifiedStorage();
            const initializeStorage = rust.initializeStorage();

            console.log('events', events);
            console.log('getModifiedStorage', getModifiedStorage);
            console.log('initializeStorage', initializeStorage);
        }
        console.log(`Total time: ${Date.now() - init}ms`);
    } catch (err) {
        console.log('error', err);
    }

})();
