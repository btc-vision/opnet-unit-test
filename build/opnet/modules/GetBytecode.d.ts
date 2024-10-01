import { Address } from '@btc-vision/bsi-binary';
declare class BytecodeManagerBase {
    private bytecodeMap;
    loadBytecode(path: string, address: Address): void;
    getBytecode(address: Address): Buffer | Uint8Array;
    setBytecode(address: Address, bytecode: Buffer): void;
}
export declare const BytecodeManager: BytecodeManagerBase;
export {};
