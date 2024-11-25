const SCALING_DECIMALS = 18;
const SCALING_FACTOR = BigInt(10) ** 4n;

export function calculateP0(basePriceSatoshisPerToken: bigint): bigint {
    return basePriceSatoshisPerToken * SCALING_FACTOR;
}
