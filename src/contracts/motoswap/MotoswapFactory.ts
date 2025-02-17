import { Blockchain, BytecodeManager, ContractRuntime } from '@btc-vision/unit-test-framework';

import { Address, BinaryReader, BinaryWriter } from '@btc-vision/transaction';
import { FACTORY_ADDRESS } from '../../common.js';

export class MotoswapFactory extends ContractRuntime {
    private readonly createPoolSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool')}`,
    );

    constructor(deployer: Address, gasLimit: bigint = 100_000_000_000n) {
        super({
            address: FACTORY_ADDRESS,
            deployer,
            gasLimit,
        });

        this.preserveState();
    }

    public async createPool(
        a: Address = Blockchain.generateRandomAddress(),
        b: Address = Blockchain.generateRandomAddress(),
    ): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.createPoolSelector);
        calldata.writeAddress(a); // token a
        calldata.writeAddress(b); // token b

        const buf = calldata.getBuffer();
        const result = await this.execute(Buffer.from(buf));

        const response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        const virtualAddress: bigint = reader.readU256();
        const pairAddress: Address = reader.readAddress();

        this.log(
            `Pair created at ${pairAddress}. Virtual address: 0x${virtualAddress.toString(16)} or ${virtualAddress}`,
        );
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/factory.wasm', this.address);
    }

    protected handleError(error: Error): Error {
        return new Error(`(in factory: ${this.address}) OPNET: ${error.stack}`);
    }
}
