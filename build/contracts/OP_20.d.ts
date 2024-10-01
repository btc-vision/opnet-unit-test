import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address } from '@btc-vision/bsi-binary';
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
export declare class OP_20 extends ContractRuntime {
    readonly fileName: string;
    readonly decimals: number;
    protected readonly transferSelector: number;
    protected readonly mintSelector: number;
    protected readonly balanceOfSelector: number;
    protected readonly totalSupplySelector: number;
    protected readonly approveSelector: number;
    constructor(fileName: string, deployer: Address, address: Address, decimals: number, gasLimit?: bigint);
    static decodeBurnEvent(data: Buffer | Uint8Array): BurnEvent;
    static decodeTransferEvent(data: Buffer | Uint8Array): TransferEvent;
    static decodeMintEvent(data: Buffer | Uint8Array): MintEvent;
    totalSupply(): Promise<bigint>;
    mint(to: Address, amount: number): Promise<void>;
    approve(owner: Address, spender: Address, amount: bigint): Promise<CallResponse>;
    transfer(from: Address, to: Address, amount: bigint): Promise<CallResponse>;
    balanceOf(owner: Address): Promise<bigint>;
    balanceOfNoDecimals(owner: Address): Promise<number>;
    protected defineRequiredBytecodes(): void;
    protected handleError(error: Error): Error;
}
