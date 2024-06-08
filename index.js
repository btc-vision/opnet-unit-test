import { Contract } from '@btc-vision/bsi-wasmer-vm';
import fs from "fs";
import { Test } from "./index2.js";
import { loadRust } from "./loaderv2.js";

const bytecode = fs.readFileSync('./bytecode/contract.wasm');
const address = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';
const deployer = 'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';

(async () => {
    const js = new Test();
    await js.load();

    try {
        /**
         * @type {import('@btc-vision/bsi-wasmer-vm').Contract}
         */
        const contract = Contract.instanciate(bytecode, address, deployer);
        const rust = await loadRust(contract);

        rust.INIT(address, deployer);

        const contractPointer = rust.getContract();
        console.log(`contractPointer: ${contractPointer}`, contractPointer);

        const viewABI = rust.getViewABI();
        console.log(`viewABI:`, viewABI);

        const calldata = Buffer.from('7462317076616a6476676873733074633733377a373273713032636761396864377776647561397663716a33353761367971686c687934736575643433390000', 'hex');
        const caller = 'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';

        const resp = rust.readMethod(0x82d62f3d, contractPointer, calldata, caller);
        console.log('resp', resp);
    } catch (err) {
        console.log('error', err);
    }

})();
