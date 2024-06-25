import fs from 'fs';
// @ts-ignore
import { loadRust } from './loader.js';
import { ABICoder, BinaryWriter } from '@btc-vision/bsi-binary';
import { Contract } from '@btc-vision/bsi-wasmer-vm';

// init();

const bytecode = fs.readFileSync('./bytecode/contract.wasm');
const abiCoder = new ABICoder();

class ContractRuntime {
    #contract: Contract | undefined;

    private readonly deployer: string =
        'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';
    private readonly address: string = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';

    constructor(bytecode: Buffer, private readonly gasLimit: bigint = 300_000_000_000n) {
        void this.init(bytecode);
    }

    public get contract(): any {
        if (!this.#contract) {
            throw new Error('Contract not initialized');
        }

        return this.#contract;
    }

    private async setEnvironment(): Promise<void> {
        const writer = new BinaryWriter();
        writer.writeAddress(this.deployer);
        writer.writeAddress(this.deployer);
        writer.writeU256(0n);
        writer.writeAddress(this.deployer);
        writer.writeAddress(this.address);
        writer.writeU64(BigInt(Date.now()));

        await this.contract.setEnvironment(writer.getBuffer());
    }

    private async call(): Promise<void> {
        const selector = Number(`0x${abiCoder.encodeSelector('createPool')}`);

        const calldata = new BinaryWriter();
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn2r'); // token a
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn32'); // token b

        const buf = calldata.getBuffer();
        const result = await this.contract.readMethod(selector, buf);
        console.log('Result:', result);
    }

    private async init(bytecode: Buffer): Promise<void> {
        console.log('Start');
        let now = Date.now();

        this.#contract = await loadRust(bytecode, this.gasLimit, this.onGas.bind(this));

        await this.setEnvironment();
        await this.call();

        console.log('End');
        console.log('Time:', Date.now() - now, 'ms');
    }

    private onGas(gas: bigint, method: string): void {
        console.log('Gas:', gas, method);
    }
}

const runtime = new ContractRuntime(bytecode);
