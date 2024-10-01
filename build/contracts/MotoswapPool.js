import { BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { OP_20 } from './OP_20.js';
import { FACTORY_ADDRESS, POOL_ADDRESS } from './configs.js';
export class MotoswapPool extends OP_20 {
    token0;
    token1;
    initializeSelector = Number(`0x${this.abiCoder.encodeSelector('initialize')}`);
    token0Selector = Number(`0x${this.abiCoder.encodeSelector('token0')}`);
    token1Selector = Number(`0x${this.abiCoder.encodeSelector('token1')}`);
    reservesSelector = Number(`0x${this.abiCoder.encodeSelector('getReserves')}`);
    swapSelector = Number(`0x${this.abiCoder.encodeSelector('swap')}`);
    burnSelector = Number(`0x${this.abiCoder.encodeSelector('burn')}`);
    syncSelector = Number(`0x${this.abiCoder.encodeSelector('sync')}`);
    price0CumulativeLastSelector = Number(`0x${this.abiCoder.encodeSelector('price0CumulativeLast')}`);
    price1CumulativeLastSelector = Number(`0x${this.abiCoder.encodeSelector('price1CumulativeLast')}`);
    constructor(token0, token1, gasLimit = 300000000000n) {
        super('pool', FACTORY_ADDRESS, POOL_ADDRESS, 18, gasLimit);
        this.token0 = token0;
        this.token1 = token1;
        // This will preserve every action done in this contract
        this.preserveState();
    }
    setAddress(address) {
        this.address = address;
    }
    setStates(states) {
        this.states = states;
    }
    static createFromRuntime(runtime, token0, token1) {
        const pool = new MotoswapPool(token0, token1);
        pool.setAddress(runtime.address);
        pool.setStates(runtime.getStates());
        return pool;
    }
    handleError(error) {
        return new Error(`(in pool: ${this.address}) OPNET: ${error.stack}`);
    }
    static decodePoolMintEvent(data) {
        const reader = new BinaryReader(data);
        return {
            to: reader.readAddress(),
            amount0: reader.readU256(),
            amount1: reader.readU256(),
        };
    }
    static decodePoolBurnEvent(data) {
        const reader = new BinaryReader(data);
        return {
            sender: reader.readAddress(),
            amount0: reader.readU256(),
            amount1: reader.readU256(),
        };
    }
    static decodeSyncEvent(data) {
        const reader = new BinaryReader(data);
        return {
            reserve0: reader.readU256(),
            reserve1: reader.readU256(),
        };
    }
    async resetStates() {
        await super.resetStates();
        await this.initializePool();
    }
    async initializePool() {
        const calldata = new BinaryWriter();
        calldata.writeAddress(this.token0); // token 0
        calldata.writeAddress(this.token1); // token 1
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.initializeSelector, Buffer.from(buf), FACTORY_ADDRESS);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        return result;
    }
    async getToken0() {
        const result = await this.readView(this.token0Selector);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        return reader.readAddress();
    }
    async getToken1() {
        const result = await this.readView(this.token1Selector);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        return reader.readAddress();
    }
    static decodeSwapEvent(data) {
        const reader = new BinaryReader(data);
        return {
            sender: reader.readAddress(),
            amount0In: reader.readU256(),
            amount1In: reader.readU256(),
            amount0Out: reader.readU256(),
            amount1Out: reader.readU256(),
            to: reader.readAddress(),
        };
    }
    async sync() {
        const result = await this.readMethod(this.syncSelector, Buffer.alloc(0));
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        return result;
    }
    async price0CumulativeLast() {
        const result = await this.readView(this.price0CumulativeLastSelector);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async price1CumulativeLast() {
        const result = await this.readView(this.price1CumulativeLastSelector);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async mintPool(to) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.mintSelector, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        return result;
    }
    async swap(amount0Out, amount1Out, to, data) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amount0Out);
        calldata.writeU256(amount1Out);
        calldata.writeAddress(to);
        calldata.writeBytesWithLength(data);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.swapSelector, Buffer.from(buf));
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
    async burnLiquidity(to) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.burnSelector, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        return result;
    }
    async getReserves() {
        const result = await this.readView(this.reservesSelector);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        return {
            reserve0: reader.readU256(),
            reserve1: reader.readU256(),
            blockTimestampLast: reader.readU64(),
        };
    }
}
