import { Contract, init } from '@btc-vision/bsi-wasmer-vm';
import fs from "fs";
import { loadRust } from "./loaderv2.js";

init();

const bytecode = fs.readFileSync('./bytecode/contract.wasm');
const address = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';
const deployer = 'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';

(async () => {
    let init = Date.now();

    try {
        /**
         * @type {import('@btc-vision/bsi-wasmer-vm').Contract}
         */

        for(let i = 0; i < 6; i++) {
            const contract = new Contract(bytecode);
            contract.init(address,deployer);

            const rustObj = await loadRust(contract);
            const rust = rustObj.adaptedExports;

            try {
                const contractPointer = rust.getContract();
                const viewABI3 = rust.getMethodABI();
                const viewABI4 = rust.getViewABI();
                rust.setEnvironment(Buffer.alloc(0));
                console.log('hello')

                const calldata = Buffer.from('0000000000000000000000000000000000000000000000000000000001312d00', 'hex');

                let callTime = Date.now();
                const resp = rust.readMethod(0x859facc5, contractPointer, calldata);
                console.log('resp', resp, `Took ${Date.now() - init}ms Call took ${Date.now() - callTime}ms`);

                const events = rust.getEvents();
                const getModifiedStorage = rust.getModifiedStorage();
                const initializeStorage = rust.initializeStorage();

                console.log('events', events);
                console.log('getModifiedStorage', getModifiedStorage);
                console.log('initializeStorage', initializeStorage);

            } catch(err) {
                const msg = err.message;
                if(msg.includes('Execution aborted')) {
                    const abortData = contract.getAbortData();
                    const message = rustObj.__liftString(abortData.message);
                    const fileName = rustObj.__liftString(abortData.fileName);
                    const line = abortData.line;
                    const column = abortData.column;

                    console.log('Error:', message);
                    console.log(`    at ${fileName}:${line}:${column}`);
                } else {
                    console.error(err);
                }
            }
        }

        console.log(`Total time: ${Date.now() - init}ms`);
    } catch (err) {
        console.error(err);
    }

    console.log('End');

})();
