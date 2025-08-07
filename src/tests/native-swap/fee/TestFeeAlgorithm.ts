const REF_TRADE_SIZE = 1_000_000n;

class DynamicFee {
    public baseFeeBP: number; // e.g. 30 => 0.30%
    public minFeeBP: number; // e.g. 10 => 0.10%
    public maxFeeBP: number; // e.g. 200 => 2.00%

    public alpha: number; // trade-size factor
    public beta: number; // volatility factor
    public gamma: number; // utilization factor

    private volatility: number;

    constructor() {
        this.baseFeeBP = 20; // 0.20%
        this.minFeeBP = 10; // 0.10%
        this.maxFeeBP = 500; // 5.00% cap

        this.alpha = 20;
        this.beta = 25;
        this.gamma = 1;

        this.volatility = 0; // default 0
    }

    public setVolatility(vol: number): void {
        this.volatility = vol;
    }

    public getDynamicFeeBP(tradeSize: bigint, utilization: number): number {
        let feeBP = this.baseFeeBP;

        let ratio = tradeSize / REF_TRADE_SIZE;
        if (ratio < 1n) {
            ratio = 1n;
        }

        const logScaled = Math.log(Number(ratio)) * 1_000_000; //this.approximateLog(ratio);
        const alphaComponent = Math.floor((this.alpha * logScaled) / 1_000_000);
        console.log(`Alpha component: ${alphaComponent}`);

        feeBP += alphaComponent;

        console.log(`Volatility: ${Math.floor((this.beta * this.volatility) / 10000)}`);
        feeBP += Math.floor((this.beta * this.volatility) / 10000);

        console.log(`Utilization: ${this.gamma * utilization}`);

        feeBP += this.gamma * utilization;

        // 5) clamp
        if (feeBP < this.minFeeBP) feeBP = this.minFeeBP;
        if (feeBP > this.maxFeeBP) feeBP = this.maxFeeBP;

        return feeBP;
    }

    public computeFeeAmount(amount: bigint, feeBP: number): bigint {
        return (amount * BigInt(feeBP)) / 10000n;
    }

    private approximateLog(ratio: bigint): bigint {
        if (ratio <= 1n) return 0n;

        // count bits => approximate floor(log2(ratio))
        let bitCount = 0n;
        let temp = ratio;
        while (temp > 1) {
            temp >>= 1n; // shift right
            bitCount++;
        }
        // ln(2) ~ 0.693 in scale 1e6 => 693147
        const LN2_SCALED = 693147n;
        // scaled ln(x) = bitCount * LN2_SCALED
        return bitCount * LN2_SCALED;
    }
}

function testSwap() {
    const dynamicFee = new DynamicFee();

    dynamicFee.setVolatility(500);

    const tradeSize = 10_000_000n; // 0.01BTC
    const utilization = 21; // 30% ?

    const totalTokensPurchased = 10_000n;

    const feeBP = dynamicFee.getDynamicFeeBP(tradeSize, utilization);
    console.log(`Dynamic Fee in BPS: ${feeBP} (i.e. ${feeBP / 100}% )`);

    const feeTokens = dynamicFee.computeFeeAmount(totalTokensPurchased, feeBP);
    console.log(`Tokens purchased: ${totalTokensPurchased}`);
    console.log(`Fee tokens: ${feeTokens}`);

    const netTokensToUser = totalTokensPurchased - feeTokens;
    console.log(`User receives net tokens: ${netTokensToUser}`);
}

testSwap();
