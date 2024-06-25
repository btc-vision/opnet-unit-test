import fs from "fs";
import {loadRust} from "./loader.js";
import {BinaryWriter} from "@btc-vision/bsi-binary";

// init();

const bytecode = fs.readFileSync('./bytecode/contract.wasm');
const address = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';
const deployer = 'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';

console.log('Start');

let now = Date.now();

try {
    /**
     * @type {import('@btc-vision/bsi-wasmer-vm').Contract}
     */

    for(let i = 0; i < 1; i++) {

        const rust = await loadRust(bytecode, 300_000_000_000n, () => {});

        try {
            // const viewABI3 = await rust.getMethodABI();
            // const viewABI4 = await rust.getViewABI();

            const writer = new BinaryWriter();
            writer.writeAddress(deployer);
            writer.writeAddress(deployer);
            writer.writeU256(0n);
            writer.writeAddress(deployer);
            writer.writeAddress(address);
            await rust.setEnvironment(writer.getBuffer());

        } catch(err) {
            console.log(err);
            const msg = err.message;
            if(msg.includes('Execution aborted')) {
                const abortData = contract.getAbortData();
                const message = rust.__liftString(abortData.message);
                const fileName = rust.__liftString(abortData.fileName);
                const line = abortData.line;
                const column = abortData.column;

                console.log('Error:', message);
                console.log(`    at ${fileName}:${line}:${column}`);
            } else {
                console.error(err);
            }
        }
    }

    console.log(`Total time: ${Date.now() - now}ms`);
} catch (err) {
    console.error(err);
}

console.log('End');
