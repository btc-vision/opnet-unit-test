import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Logger } from '@btc-vision/logger';

class BlockchainBase extends Logger {
    public readonly logColor: string = '#8332ff';

    public traceGas: boolean = false;
    private readonly contracts: Map<string, ContractRuntime> = new Map<string, ContractRuntime>();

    constructor() {
        super();
    }

    public register(contract: ContractRuntime): void {
        if (this.contracts.has(contract.address)) {
            throw new Error(`Contract already registered at address ${contract.address}`);
        }

        this.contracts.set(contract.address, contract);
    }

    public getContract(address: string): ContractRuntime {
        const contract = this.contracts.get(address);

        if (!contract) {
            throw new Error(`Contract not found at address ${address}`);
        }

        return contract;
    }

    public dispose(): void {
        for (const contract of this.contracts.values()) {
            contract.dispose();
        }
    }

    public async init(): Promise<void> {
        this.dispose();

        for (const contract of this.contracts.values()) {
            await contract.init();
        }
    }

    public enableGasTracking(): void {
        this.traceGas = true;
    }

    public disableGasTracking(): void {
        this.traceGas = false;
    }
}

export const Blockchain = new BlockchainBase();
