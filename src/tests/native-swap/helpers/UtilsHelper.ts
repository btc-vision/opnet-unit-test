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

export function calculateHalfToCharge(initialAmount: bigint, penaltyAmount: bigint): bigint {
    const halfCred = half(initialAmount);

    const halfToCharge: bigint = penaltyAmount < halfCred ? penaltyAmount : halfCred;

    return halfToCharge;
}

export function calculatePenaltyLeft(initialAmount: bigint, penaltyAmount: bigint): bigint {
    let penaltyLeft: bigint = 0n;

    if (penaltyAmount > 0) {
        const halfToCharge = calculateHalfToCharge(initialAmount, penaltyAmount);
        penaltyLeft = penaltyAmount - halfToCharge;
    }

    return penaltyLeft;
}
