import { Address, BinaryReader, BinaryWriter } from '@btc-vision/transaction';

import {
    CallResponse,
    ContractRuntime,
    FastBigIntMap,
    OP_20,
} from '@btc-vision/unit-test-framework';
import { FACTORY_ADDRESS, POOL_ADDRESS } from '../../common.js';

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
    readonly blockTimestampLast: bigint;
}

export interface SwapEvent {
    readonly sender: Address;
    readonly amount0In: bigint;
    readonly amount1In: bigint;
    readonly amount0Out: bigint;
    readonly amount1Out: bigint;
    readonly to: Address;
}

export interface BurnLiquidityEvent {
    readonly sender: Address;
    readonly amount0: bigint;
    readonly amount1: bigint;
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

    private readonly swapSelector: number = Number(`0x${this.abiCoder.encodeSelector('swap')}`);
    private readonly burnSelector: number = Number(`0x${this.abiCoder.encodeSelector('burn')}`);

    private readonly syncSelector: number = Number(`0x${this.abiCoder.encodeSelector('sync')}`);
    private readonly price0CumulativeLastSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('price0CumulativeLast')}`,
    );
    private readonly price1CumulativeLastSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('price1CumulativeLast')}`,
    );

    constructor(
        private readonly token0: Address,
        private readonly token1: Address,
        address: Address = POOL_ADDRESS,
        gasLimit: bigint = 100_000_000_000n,
    ) {
        super({
            file: 'pool',
            deployer: FACTORY_ADDRESS,
            address: address,
            decimals: 18,
            gasLimit,
        });

        // This will preserve every action done in this contract
        this.preserveState();
    }

    public static createFromRuntime(
        runtime: ContractRuntime,
        token0: Address,
        token1: Address,
    ): MotoswapPool {
        const pool = new MotoswapPool(token0, token1);
        pool.setAddress(runtime.address);
        pool.setStates(runtime.getStates());

        return pool;
    }

    public static decodePoolMintEvent(data: Uint8Array): PoolMintEvent {
        const reader: BinaryReader = new BinaryReader(data);

        return {
            to: reader.readAddress(),
            amount0: reader.readU256(),
            amount1: reader.readU256(),
        };
    }

    public static decodePoolBurnEvent(data: Uint8Array): BurnLiquidityEvent {
        const reader: BinaryReader = new BinaryReader(data);

        return {
            sender: reader.readAddress(),
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

    public static decodeSwapEvent(data: Uint8Array): SwapEvent {
        const reader: BinaryReader = new BinaryReader(data);
        return {
            sender: reader.readAddress(),
            amount0In: reader.readU256(),
            amount1In: reader.readU256(),
            amount0Out: reader.readU256(),
            amount1Out: reader.readU256(),
            to: reader.readAddress(),
        };
    }

    public setAddress(address: Address) {
        this.address = address;
    }

    public setStates(states: FastBigIntMap) {
        this.states = states;
    }

    public override async resetStates(): Promise<void> {
        await super.resetStates();
        await this.initializePool();
    }

    public async initializePool(): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.initializeSelector);
        calldata.writeAddress(this.token0); // token 0
        calldata.writeAddress(this.token1); // token 1

        const buf = calldata.getBuffer();
        const result = await this.execute(Buffer.from(buf), FACTORY_ADDRESS);

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        return result;
    }

    public async getToken0(): Promise<Address> {
        const binaryWriter = new BinaryWriter();
        binaryWriter.writeSelector(this.token0Selector);

        const result = await this.execute(Buffer.from(binaryWriter.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return reader.readAddress();
    }

    public async getToken1(): Promise<Address> {
        const binaryWriter = new BinaryWriter();
        binaryWriter.writeSelector(this.token1Selector);

        const result = await this.execute(Buffer.from(binaryWriter.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return reader.readAddress();
    }

    public async sync(): Promise<CallResponse> {
        const binaryWriter = new BinaryWriter();
        binaryWriter.writeSelector(this.syncSelector);

        const result = await this.execute(Buffer.from(binaryWriter.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        return result;
    }

    public async price0CumulativeLast(): Promise<bigint> {
        const binaryWriter = new BinaryWriter();
        binaryWriter.writeSelector(this.price0CumulativeLastSelector);

        const result = await this.execute(Buffer.from(binaryWriter.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return reader.readU256();
    }

    public async price1CumulativeLast(): Promise<bigint> {
        const binaryWriter = new BinaryWriter();
        binaryWriter.writeSelector(this.price1CumulativeLastSelector);

        const result = await this.execute(Buffer.from(binaryWriter.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return reader.readU256();
    }

    public async mintPool(to: Address): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.mintSelector);
        calldata.writeAddress(to);

        const buf = calldata.getBuffer();
        const result = await this.execute(Buffer.from(buf));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        return result;
    }

    public async swap(
        amount0Out: bigint,
        amount1Out: bigint,
        to: Address,
        data: Uint8Array,
    ): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.swapSelector);
        calldata.writeU256(amount0Out);
        calldata.writeU256(amount1Out);
        calldata.writeAddress(to);
        calldata.writeBytesWithLength(data);

        const buf = calldata.getBuffer();
        const result = await this.execute(Buffer.from(buf));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error('Swap failed');
        }

        return result;
    }

    public async burnLiquidity(to: Address): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.burnSelector);
        calldata.writeAddress(to);

        const buf = calldata.getBuffer();
        const result = await this.execute(Buffer.from(buf));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        return result;
    }

    public async reserve0(): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.reservesSelector);

        const result = await this.execute(Buffer.from(calldata.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return reader.readU256();
    }

    public async reserve1(): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.reservesSelector);

        const result = await this.execute(Buffer.from(calldata.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        reader.readU256(); // skip reserve0
        return reader.readU256();
    }

    public async getReserves(): Promise<Reserves> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.reservesSelector);

        const result = await this.execute(Buffer.from(calldata.getBuffer()));

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return {
            reserve0: reader.readU256(),
            reserve1: reader.readU256(),
            blockTimestampLast: reader.readU64(),
        };
    }

    protected handleError(error: Error): Error {
        return new Error(`(in pool: ${this.address}) OPNET: ${error.stack}`);
    }
}
