import { init, Wasmer } from "@wasmer/sdk";
import fs from 'fs';
import { load } from "./loader.js";

export class Test {
    wasmModule = null;
    bytecode = fs.readFileSync('./bytecode/contract.wasm');

    memory = new WebAssembly.Memory({ initial: 1024, maximum: 65536 });
    exported = null;

    constructor() {
    }

    async load() {
        this.wasmModule = await WebAssembly.compile(this.bytecode);

        console.log('compiled module', this.wasmModule);

        try {
            //await init();  //this.memory
            //console.log('idk', idk, Wasmer);

            this.exported = await load(this.wasmModule);

            console.log('initializated...');

            //const idk = await Wasmer.fromFile(this.bytecode);
            //console.log('idk', idk);
        } catch(e) {
            console.log('error', e.stack);
        }
    }
}

new Test;
