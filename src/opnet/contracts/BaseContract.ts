import { ContractRuntime } from '../modules/ContractRuntime.js';
import { BytecodeManager } from '../modules/GetBytecode.js';

export class BaseContract extends ContractRuntime {
    public constructor(
        public readonly contractBytecode: Buffer,
        public readonly address: string,
        public readonly deployer: string,
        protected readonly gasLimit: bigint = 300_000_000_000n,
    ) {
        super(address, deployer, gasLimit);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.setBytecode(this.address, this.contractBytecode);
    }
}
