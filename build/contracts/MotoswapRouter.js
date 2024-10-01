import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { ROUTER_ADDRESS } from './configs.js';
export class MotoswapRouter extends ContractRuntime {
    ADD_LIQUIDITY_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('addLiquidity')}`);
    QUOTE_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('quote')}`);
    GET_AMOUNT_OUT_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('getAmountOut')}`);
    GET_AMOUNT_IN_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('getAmountIn')}`);
    GET_AMOUNTS_OUT_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('getAmountsOut')}`);
    GET_AMOUNTS_IN_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('getAmountsIn')}`);
    swapExactTokensForTokensSupportingFeeOnTransferTokensSelector = Number(`0x${this.abiCoder.encodeSelector('swapExactTokensForTokensSupportingFeeOnTransferTokens')}`);
    FACTORY_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('factory')}`);
    WBTC_SELECTOR = Number(`0x${this.abiCoder.encodeSelector('WBTC')}`);
    constructor(deployer, gasLimit = 300000000000n) {
        super(ROUTER_ADDRESS, deployer, gasLimit);
        this.preserveState();
    }
    handleError(error) {
        return new Error(`(in router: ${this.address}) OPNET: ${error.stack}`);
    }
    defineRequiredBytecodes() {
        BytecodeManager.loadBytecode('./bytecode/router.wasm', this.address);
    }
    async getFactory() {
        const result = await this.readView(this.FACTORY_SELECTOR);
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readAddress();
    }
    async getWBTC() {
        const result = await this.readView(this.WBTC_SELECTOR);
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readAddress();
    }
    async quote(amountA, reserveA, reserveB) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountA);
        calldata.writeU256(reserveA);
        calldata.writeU256(reserveB);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.QUOTE_SELECTOR, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async getAmountOut(amountIn, reserveIn, reserveOut) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountIn);
        calldata.writeU256(reserveIn);
        calldata.writeU256(reserveOut);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNT_OUT_SELECTOR, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async getAmountIn(amountOut, reserveIn, reserveOut) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountOut);
        calldata.writeU256(reserveIn);
        calldata.writeU256(reserveOut);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNT_IN_SELECTOR, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async getAmountsOut(amountIn, path) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountIn);
        calldata.writeAddressArray(path);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNTS_OUT_SELECTOR, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readTuple();
    }
    async getAmountsIn(amountOut, path) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountOut);
        calldata.writeAddressArray(path);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNTS_IN_SELECTOR, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        const reader = new BinaryReader(response);
        return reader.readTuple();
    }
    async addLiquidity(parameters) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(parameters.tokenA);
        calldata.writeAddress(parameters.tokenB);
        calldata.writeU256(parameters.amountADesired);
        calldata.writeU256(parameters.amountBDesired);
        calldata.writeU256(parameters.amountAMin);
        calldata.writeU256(parameters.amountBMin);
        calldata.writeAddress(parameters.to);
        calldata.writeU64(parameters.deadline);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.ADD_LIQUIDITY_SELECTOR, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        return result;
    }
    async swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, to, deadline) {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountIn);
        calldata.writeU256(amountOutMin);
        calldata.writeAddressArray(path);
        calldata.writeAddress(to);
        calldata.writeU64(deadline);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.swapExactTokensForTokensSupportingFeeOnTransferTokensSelector, Buffer.from(buf));
        const response = result.response;
        if (!response) {
            throw result.error;
        }
        this.dispose();
        return result;
    }
}
