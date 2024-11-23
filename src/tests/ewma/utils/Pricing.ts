/**
 * Calculates the token price using BigInt and fixed-point arithmetic.
 *
 * @param P0 - Base price (minimum acceptable price) in satoshis, scaled by DECIMALS.
 * @param k - Scaling constant, scaled by DECIMALS.
 * @param EWMA_V - Exponentially Weighted Moving Average of buy volume.
 * @param EWMA_L - Exponentially Weighted Moving Average of total liquidity.
 * @param DECIMALS - The scaling factor used for fixed-point arithmetic.
 * @returns The adjusted token price in satoshis, scaled by DECIMALS.
 */
export function calculatePrice(
    P0: bigint,
    k: bigint,
    EWMA_V: bigint,
    EWMA_L: bigint,
    DECIMALS: bigint,
): bigint {
    // Prevent division by zero
    if (EWMA_L === BigInt(0)) {
        return P0;
    }

    // Calculate the ratio: (EWMA_V * DECIMALS) / EWMA_L
    const ratio = (EWMA_V * DECIMALS) / EWMA_L;

    // Calculate the scaled adjustment: (k * ratio) / DECIMALS
    const scaledAdjustment = (k * ratio) / DECIMALS;

    // Calculate the adjusted price: (P0 * (DECIMALS + scaledAdjustment)) / DECIMALS
    const adjustedPrice = (P0 * (DECIMALS + scaledAdjustment)) / DECIMALS;

    // Ensure the price does not fall below the base price
    return adjustedPrice > P0 ? adjustedPrice : P0;
}

/**
 * Updates the EWMA value using BigInt and fixed-point arithmetic.
 *
 * @param currentValue - The current data point (buy volume or liquidity) as BigInt.
 * @param previousEWMA - The previous EWMA value as BigInt.
 * @param alpha - The smoothing factor, scaled by DECIMALS.
 * @param DECIMALS - The scaling factor used for fixed-point arithmetic.
 * @returns The updated EWMA value as BigInt.
 */
export function updateEWMA(
    currentValue: bigint,
    previousEWMA: bigint,
    alpha: bigint,
    DECIMALS: bigint,
): bigint {
    // EWMA = alpha * currentValue + (1 - alpha) * previousEWMA
    // Since we can't represent (1 - alpha) directly, compute it as (DECIMALS - alpha)
    const oneMinusAlpha = DECIMALS - alpha;

    // Calculate EWMA: (alpha * currentValue + (DECIMALS - alpha) * previousEWMA) / DECIMALS
    return (alpha * currentValue + oneMinusAlpha * previousEWMA) / DECIMALS;
}
