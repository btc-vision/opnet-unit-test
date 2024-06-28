import { Contract } from '@btc-vision/bsi-wasmer-vm';

export interface ContractParameters {
    readonly bytecode: Buffer;
    readonly gasLimit: bigint;
    readonly gasCallback: (gas: bigint, method: string) => void;

    readonly load: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly store: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly call: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
}


export interface ExportedContract extends Contract {
}


export declare function loadRust(contractParameters: ContractParameters): Promise<ExportedContract>;
