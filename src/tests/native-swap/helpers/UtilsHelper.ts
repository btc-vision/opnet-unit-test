export function expandBigIntTo18Decimals(n: bigint): bigint {
    return n * 10n ** 18n;
}

export function expandNumberTo18Decimals(n: number): bigint {
    return BigInt(n) * 10n ** 18n;
}

export function half(value: bigint): bigint {
    const halfFloor = value / 2n;

    return halfFloor + (value & 1n);
}

export function computeSlashing(oldLiquidity: bigint, amountIn: bigint): bigint {
    const newTotal: bigint = oldLiquidity + amountIn;
    const oldHalfCred: bigint = half(oldLiquidity);
    const newHalfCred: bigint = half(newTotal);
    const deltaHalf: bigint = newHalfCred - oldHalfCred;

    return deltaHalf;
}
