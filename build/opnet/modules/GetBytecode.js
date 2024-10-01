import fs from 'fs';
class BytecodeManagerBase {
    bytecodeMap = new Map();
    loadBytecode(path, address) {
        const bytecode = fs.readFileSync(path);
        this.setBytecode(address, bytecode);
    }
    getBytecode(address) {
        const bytecode = this.bytecodeMap.get(address);
        if (!bytecode) {
            throw new Error(`Bytecode for address ${address} not found`);
        }
        return bytecode;
    }
    setBytecode(address, bytecode) {
        if (this.bytecodeMap.has(address)) {
            return;
        }
        this.bytecodeMap.set(address, bytecode);
    }
}
export const BytecodeManager = new BytecodeManagerBase();
