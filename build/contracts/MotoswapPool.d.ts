import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address } from '@btc-vision/bsi-binary';
import { OP_20 } from './OP_20.js';
export interface SyncEvent {
    readonly reserve0: bigint;
    readonly reserve1: bigint;
}
export interface PoolMintEvent {
    readonly to: Address;
    readonly amount0: bigint;
    readonly amount1: bigint;
}
export interface Reserves {
    readonly reserve0: bigint;
    readonly reserve1: bigint;
    readonly blockTimestampLast: bigint;
}
export interface SwapEvent {
    readonly sender: Address;
    readonly amount0In: bigint;
    readonly amount1In: bigint;
    readonly amount0Out: bigint;
    readonly amount1Out: bigint;
    readonly to: Address;
}
export interface BurnLiquidityEvent {
    readonly sender: Address;
    readonly amount0: bigint;
    readonly amount1: bigint;
}
export declare class MotoswapPool extends OP_20 {
    private readonly token0;
    private readonly token1;
    private readonly initializeSelector;
    private readonly token0Selector;
    private readonly token1Selector;
    private readonly reservesSelector;
    private readonly swapSelector;
    private readonly burnSelector;
    private readonly syncSelector;
    private readonly price0CumulativeLastSelector;
    private readonly price1CumulativeLastSelector;
    constructor(token0: Address, token1: Address, gasLimit?: bigint);
    setAddress(address: Address): void;
    setStates(states: Map<bigint, bigint>): void;
    static createFromRuntime(runtime: ContractRuntime, token0: Address, token1: Address): MotoswapPool;
    protected handleError(error: Error): Error;
    static decodePoolMintEvent(data: Uint8Array): PoolMintEvent;
    static decodePoolBurnEvent(data: Uint8Array): BurnLiquidityEvent;
    static decodeSyncEvent(data: Uint8Array): SyncEvent;
    resetStates(): Promise<void>;
    initializePool(): Promise<CallResponse>;
    getToken0(): Promise<Address>;
    getToken1(): Promise<Address>;
    static decodeSwapEvent(data: Uint8Array): SwapEvent;
    sync(): Promise<CallResponse>;
    price0CumulativeLast(): Promise<bigint>;
    price1CumulativeLast(): Promise<bigint>;
    mintPool(to: Address): Promise<CallResponse>;
    swap(amount0Out: bigint, amount1Out: bigint, to: Address, data: Uint8Array): Promise<CallResponse>;
    burnLiquidity(to: Address): Promise<CallResponse>;
    getReserves(): Promise<Reserves>;
}
