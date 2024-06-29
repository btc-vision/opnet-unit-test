import { Address } from '@btc-vision/bsi-binary';
import fs from 'fs';

class BytecodeManagerBase {
    private bytecodeMap: Map<Address, Buffer | Uint8Array> = new Map();

    constructor() {}

    public loadBytecode(path: string, address: Address): void {
        const bytecode = fs.readFileSync(path);

        this.setBytecode(address, bytecode);
    }

    public getBytecode(address: Address): Buffer | Uint8Array {
        const bytecode = this.bytecodeMap.get(address);
        if (!bytecode) {
            throw new Error(`Bytecode for address ${address} not found`);
        }

        return bytecode;
    }

    public setBytecode(address: Address, bytecode: Buffer): void {
        if (this.bytecodeMap.has(address)) {
            return;
        }

        this.bytecodeMap.set(address, bytecode);
    }
}

export const BytecodeManager = new BytecodeManagerBase();
