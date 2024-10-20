import { Address } from '@btc-vision/transaction';
import { Reserves } from '../contracts/MotoswapPool.js';

export function sortTokens(tokenA: Address, tokenB: Address): Address[] {
    if (tokenA.lessThan(tokenB)) {
        return [tokenA, tokenB];
    } else {
        return [tokenB, tokenA];
    }
}

export function getReserves(
    tokenA: Address,
    tokenB: Address,
    reserve0: bigint,
    reserve1: bigint,
): Reserves {
    const [token0, _token1] = sortTokens(tokenA, tokenB);

    return {
        reserve0: token0 === tokenA ? reserve0 : reserve1,
        reserve1: token0 === tokenA ? reserve1 : reserve0,
        blockTimestampLast: 0n,
    };
}
