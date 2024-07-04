import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { FACTORY_ADDRESS } from './configs.js';

export class MotoswapFactory extends ContractRuntime {
    private readonly createPoolSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool')}`,
    );

    constructor(gasLimit: bigint = 300_000_000_000n) {
        super(
            FACTORY_ADDRESS,
            'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
            gasLimit,
        );

        this.preserveState();
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/factory.wasm', this.address);
    }

    protected handleError(error: Error): Error {
        return new Error(`(in factory: ${this.address}) OPNET: ${error.stack}`);
    }

    public async createPool(): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(Blockchain.generateRandomSegwitAddress()); // token a
        calldata.writeAddress(Blockchain.generateRandomSegwitAddress()); // token b

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.createPoolSelector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        const virtualAddress: bigint = reader.readU256();
        const pairAddress: Address = reader.readAddress();

        this.log(
            `Pair created at ${pairAddress}. Virtual address: 0x${virtualAddress.toString(16)} or ${virtualAddress}`,
        );

        this.dispose();
    }
}
