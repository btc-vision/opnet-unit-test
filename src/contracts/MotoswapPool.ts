import { CallResponse } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { OP_20 } from './OP_20.js';

export interface SyncEvent {
    readonly reserve0: bigint;
    readonly reserve1: bigint;
}

export interface PoolMintEvent {
    readonly to: Address;
    readonly amount0: bigint;
    readonly amount1: bigint;
}

export interface Reserves {
    readonly reserve0: bigint;
    readonly reserve1: bigint;
}

export class MotoswapPool extends OP_20 {
    private readonly initializeSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('initialize')}`,
    );

    private readonly token0Selector: number = Number(`0x${this.abiCoder.encodeSelector('token0')}`);
    private readonly token1Selector: number = Number(`0x${this.abiCoder.encodeSelector('token1')}`);
    private readonly reservesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getReserves')}`,
    );

    constructor(
        private readonly token0: Address,
        private readonly token1: Address,
        gasLimit: bigint = 300_000_000_000n,
    ) {
        super('pool', 'bcrt1q6tttv4cdg8eczf0cnk0fz4a65dc5yre92qa728', 18, gasLimit);

        // This will preserve every action done in this contract
        this.preserveState();
    }

    public static decodePoolMintEvent(data: Uint8Array): PoolMintEvent {
        const reader: BinaryReader = new BinaryReader(data);

        return {
            to: reader.readAddress(),
            amount0: reader.readU256(),
            amount1: reader.readU256(),
        };
    }

    public static decodeSyncEvent(data: Uint8Array): SyncEvent {
        const reader: BinaryReader = new BinaryReader(data);
        return {
            reserve0: reader.readU256(),
            reserve1: reader.readU256(),
        };
    }

    public async initializePool(): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(this.token0); // token 0
        calldata.writeAddress(this.token1); // token 1

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.initializeSelector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        return result;
    }

    public async getToken0(): Promise<Address> {
        const result = await this.readView(this.token0Selector);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        return reader.readAddress();
    }

    public async getToken1(): Promise<Address> {
        const result = await this.readView(this.token1Selector);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        return reader.readAddress();
    }

    public async mintPool(): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        const buf = calldata.getBuffer();

        const result = await this.readMethod(this.mintSelector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        return result;
    }

    public async getReserves(): Promise<Reserves> {
        const result = await this.readView(this.reservesSelector);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        return {
            reserve0: reader.readU256(),
            reserve1: reader.readU256(),
        };
    }
}
