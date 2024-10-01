import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address } from '@btc-vision/bsi-binary';
import { AddLiquidityParameters } from '../interfaces/RouterInterfaces.js';
export declare class MotoswapRouter extends ContractRuntime {
    private readonly ADD_LIQUIDITY_SELECTOR;
    private readonly QUOTE_SELECTOR;
    private readonly GET_AMOUNT_OUT_SELECTOR;
    private readonly GET_AMOUNT_IN_SELECTOR;
    private readonly GET_AMOUNTS_OUT_SELECTOR;
    private readonly GET_AMOUNTS_IN_SELECTOR;
    private readonly swapExactTokensForTokensSupportingFeeOnTransferTokensSelector;
    private readonly FACTORY_SELECTOR;
    private readonly WBTC_SELECTOR;
    constructor(deployer: Address, gasLimit?: bigint);
    protected handleError(error: Error): Error;
    protected defineRequiredBytecodes(): void;
    getFactory(): Promise<Address>;
    getWBTC(): Promise<Address>;
    quote(amountA: bigint, reserveA: bigint, reserveB: bigint): Promise<bigint>;
    getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): Promise<bigint>;
    getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): Promise<bigint>;
    getAmountsOut(amountIn: bigint, path: Address[]): Promise<bigint[]>;
    getAmountsIn(amountOut: bigint, path: Address[]): Promise<bigint[]>;
    addLiquidity(parameters: AddLiquidityParameters): Promise<CallResponse>;
    swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn: bigint, amountOutMin: bigint, path: Address[], to: Address, deadline: bigint): Promise<CallResponse>;
}
