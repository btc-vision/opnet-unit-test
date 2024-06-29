import { ContractRuntime } from '../modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../modules/GetBytecode.js';

export class MotoswapFactory extends ContractRuntime {
    private readonly createPoolSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool')}`,
    );

    private readonly initializeSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('initialize')}`,
    );

    private readonly token0Selector: number = Number(`0x${this.abiCoder.encodeSelector('token0')}`);

    constructor(bytecode: Buffer, gasLimit: bigint = 300_000_000_000n) {
        super(bytecode, gasLimit);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode(
            './bytecode/pool.wasm',
            'bcrt1qhhgneff7tlmugylvt4quuzjt4q2hzee0y9sw82',
        );

        BytecodeManager.loadBytecode(
            './bytecode/factory.wasm',
            'bcrt1qhhgneff7tlmugylvt4quuzjt4q2hzee0y9sw81',
        );
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
