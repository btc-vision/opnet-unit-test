import { Contract } from '@btc-vision/bsi-wasmer-vm';

export interface ContractParameters {
    readonly bytecode: Buffer;
    readonly gasLimit: bigint;
    readonly gasCallback: (gas: bigint, method: string) => void;

    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
}


export interface ExportedContract extends Contract {
}


export declare function loadRust(contractParameters: ContractParameters): Promise<ExportedContract>;
