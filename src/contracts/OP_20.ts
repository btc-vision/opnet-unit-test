import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { Blockchain } from '../blockchain/Blockchain.js';

export interface TransferEvent {
    readonly from: Address;
    readonly to: Address;
    readonly value: bigint;
}

export interface MintEvent {
    readonly to: Address;
    readonly value: bigint;
}

export interface BurnEvent {
    readonly value: bigint;
}

export class OP_20 extends ContractRuntime {
    protected readonly transferSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('transfer')}`,
    );

    protected readonly mintSelector: number = Number(`0x${this.abiCoder.encodeSelector('mint')}`);

    protected readonly balanceOfSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('balanceOf')}`,
    );

    protected readonly totalSupplySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('totalSupply')}`,
    );

    protected readonly approveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('approve')}`,
    );

    constructor(
        public readonly fileName: string,
        deployer: Address,
        address: Address,
        public readonly decimals: number,
        gasLimit: bigint = 100_000_000_000n,
    ) {
        super(address, deployer, gasLimit);

        this.preserveState();
    }

    public static decodeBurnEvent(data: Buffer | Uint8Array): BurnEvent {
        const reader = new BinaryReader(data);
        const value = reader.readU256();

        return { value };
    }

    public static decodeTransferEvent(data: Buffer | Uint8Array): TransferEvent {
        const reader = new BinaryReader(data);
        const from = reader.readAddress();
        const to = reader.readAddress();
        const value = reader.readU256();

        return { from, to, value };
    }

    public static decodeMintEvent(data: Buffer | Uint8Array): MintEvent {
        const reader = new BinaryReader(data);
        const to = reader.readAddress();
        const value = reader.readU256();

        return { to, value };
    }

    public async totalSupply(): Promise<bigint> {
        const result = await this.readView(this.totalSupplySelector);

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(response);
        return reader.readU256();
    }

    public async mint(to: Address, amount: number): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        calldata.writeU256(Blockchain.expandToDecimal(amount, this.decimals));
        calldata.writeAddressValueTupleMap(new Map());
        calldata.writeU256(0n);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(
            this.mintSelector,
            Buffer.from(buf),
            this.deployer,
            this.deployer,
        );

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

    public async approve(owner: Address, spender: Address, amount: bigint): Promise<CallResponse> {
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

    public async transfer(from: Address, to: Address, amount: bigint): Promise<CallResponse> {
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

    public async balanceOf(owner: Address): Promise<bigint> {
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

    public async balanceOfNoDecimals(owner: Address): Promise<number> {
        const balance = await this.balanceOf(owner);

        return Blockchain.decodeFromDecimal(balance, this.decimals);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode(`./bytecode/${this.fileName}.wasm`, this.address);
    }

    protected handleError(error: Error): Error {
        return new Error(`(in op_20: ${this.address}) OPNET: ${error.stack}`);
    }
}
