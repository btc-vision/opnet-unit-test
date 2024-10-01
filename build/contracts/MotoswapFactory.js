import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { FACTORY_ADDRESS } from './configs.js';
export class MotoswapFactory extends ContractRuntime {
    createPoolSelector = Number(`0x${this.abiCoder.encodeSelector('createPool')}`);
    constructor(deployer, gasLimit = 300000000000n) {
        super(FACTORY_ADDRESS, deployer, gasLimit);
        this.preserveState();
    }
    async createPool(a = Blockchain.generateRandomSegwitAddress(), b = Blockchain.generateRandomSegwitAddress()) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(a); // token a
        calldata.writeAddress(b); // token b
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.createPoolSelector, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        const reader = new BinaryReader(response);
        const virtualAddress = reader.readU256();
        const pairAddress = reader.readAddress();
        this.log(`Pair created at ${pairAddress}. Virtual address: 0x${virtualAddress.toString(16)} or ${virtualAddress}`);
    }
    defineRequiredBytecodes() {
        BytecodeManager.loadBytecode('./bytecode/factory.wasm', this.address);
    }
    handleError(error) {
        return new Error(`(in factory: ${this.address}) OPNET: ${error.stack}`);
    }
}
