import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';

export class MotoswapPool extends ContractRuntime {
    private readonly initializeSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('initialize')}`,
    );

    private readonly token0Selector: number = Number(`0x${this.abiCoder.encodeSelector('token0')}`);

    constructor(gasLimit: bigint = 300_000_000_000n) {
        super(
            'bcrt1q6tttv4cdg8eczf0cnk0fz4a65dc5yre92qa728',
            'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
            gasLimit,
        );
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/pool.wasm', this.address);
    }

    public async initializePool(): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn2r'); // token a
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn32'); // token b

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.initializeSelector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        console.log('response', response);

        this.dispose();
    }

    public async getToken0(): Promise<void> {
        const result = await this.readView(this.token0Selector);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        const token0: Address = reader.readAddress();

        this.info(`Token0: ${token0}`);

        this.dispose();
    }
}
