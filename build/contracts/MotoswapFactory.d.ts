import { ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address } from '@btc-vision/bsi-binary';
export declare class MotoswapFactory extends ContractRuntime {
    private readonly createPoolSelector;
    constructor(deployer: Address, gasLimit?: bigint);
    createPool(a?: Address, b?: Address): Promise<void>;
    protected defineRequiredBytecodes(): void;
    protected handleError(error: Error): Error;
}
