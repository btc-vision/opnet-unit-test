import { Address } from '@btc-vision/transaction';
import { Reserves } from '../contracts/MotoswapPool.js';

export function sortTokens(tokenA: Address, tokenB: Address): Address[] {
    if (tokenA.isBiggerThan(tokenB)) {
        return [tokenB, tokenA];
    } else {
        return [tokenA, tokenB];
    }
}

export function getReserves(
    tokenA: Address,
    tokenB: Address,
    reserve0: bigint,
    reserve1: bigint,
): Reserves {
    const [token0, token1] = sortTokens(tokenA, tokenB);

    return {
        reserve0: token0 === tokenA ? reserve0 : reserve1,
        reserve1: token0 === tokenA ? reserve1 : reserve0,
        blockTimestampLast: 0n,
    };
}
