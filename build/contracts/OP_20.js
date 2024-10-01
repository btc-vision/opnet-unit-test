import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { Blockchain } from '../blockchain/Blockchain.js';
export class OP_20 extends ContractRuntime {
    fileName;
    decimals;
    transferSelector = Number(`0x${this.abiCoder.encodeSelector('transfer')}`);
    mintSelector = Number(`0x${this.abiCoder.encodeSelector('mint')}`);
    balanceOfSelector = Number(`0x${this.abiCoder.encodeSelector('balanceOf')}`);
    totalSupplySelector = Number(`0x${this.abiCoder.encodeSelector('totalSupply')}`);
    approveSelector = Number(`0x${this.abiCoder.encodeSelector('approve')}`);
    constructor(fileName, deployer, address, decimals, gasLimit = 300000000000n) {
        super(address, deployer, gasLimit);
        this.fileName = fileName;
        this.decimals = decimals;
        this.preserveState();
    }
    static decodeBurnEvent(data) {
        const reader = new BinaryReader(data);
        const value = reader.readU256();
        return { value };
    }
    static decodeTransferEvent(data) {
        const reader = new BinaryReader(data);
        const from = reader.readAddress();
        const to = reader.readAddress();
        const value = reader.readU256();
        return { from, to, value };
    }
    static decodeMintEvent(data) {
        const reader = new BinaryReader(data);
        const to = reader.readAddress();
        const value = reader.readU256();
        return { to, value };
    }
    async totalSupply() {
        const result = await this.readView(this.totalSupplySelector);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async mint(to, amount) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        calldata.writeU256(Blockchain.expandToDecimal(amount, this.decimals));
        calldata.writeAddressValueTupleMap(new Map());
        calldata.writeU256(0n);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.mintSelector, Buffer.from(buf), this.deployer, this.deployer);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error('Mint failed');
        }
    }
    async approve(owner, spender, amount) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(spender);
        calldata.writeU256(amount);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.approveSelector, Buffer.from(buf), owner, owner);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error('Mint failed');
        }
        return result;
    }
    async transfer(from, to, amount) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        calldata.writeU256(amount);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.transferSelector, Buffer.from(buf), from, from);
        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error('Transfer failed');
        }
        return result;
    }
    async balanceOf(owner) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(owner);
        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.balanceOfSelector, Buffer.from(buf));
        const response = result.response;
        if (result.error || !response) {
            this.dispose();
            throw this.handleError(result.error || new Error('No response'));
        }
        const reader = new BinaryReader(response);
        return reader.readU256();
    }
    async balanceOfNoDecimals(owner) {
        const balance = await this.balanceOf(owner);
        return Blockchain.decodeFromDecimal(balance, this.decimals);
    }
    defineRequiredBytecodes() {
        BytecodeManager.loadBytecode(`./bytecode/${this.fileName}.wasm`, this.address);
    }
    handleError(error) {
        return new Error(`(in op_20: ${this.address}) OPNET: ${error.stack}`);
    }
}
