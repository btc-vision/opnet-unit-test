import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';

export class MotoswapFactory extends ContractRuntime {
    private readonly createPoolSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool')}`,
    );

    constructor(gasLimit: bigint = 300_000_000_000n) {
        super(
            'bcrt1q6tttv4cdg8eczf0cnk0fz4a65dc5yre92qa729',
            'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
            gasLimit,
        );
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/factory.wasm', this.address);
    }

    public async createPool(): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn2r'); // token a
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn32'); // token b

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.createPoolSelector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        const virtualAddress: bigint = reader.readU256();
        const pairAddress: Address = reader.readAddress();

        this.log(
            `Pair created at ${pairAddress}. Virtual address: 0x${virtualAddress.toString(16)} or ${virtualAddress}`,
        );

        this.dispose();
    }
}
