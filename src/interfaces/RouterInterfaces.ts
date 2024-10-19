import { Address } from '@btc-vision/transaction';

export interface AddLiquidityParameters {
    readonly tokenA: Address;
    readonly tokenB: Address;

    readonly amountADesired: bigint;
    readonly amountBDesired: bigint;

    readonly amountAMin: bigint;
    readonly amountBMin: bigint;

    readonly to: Address;
    readonly deadline: bigint;
}
