import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { Assert, Blockchain } from '@btc-vision/unit-test-framework';
import { TokenHelper } from './TokenHelper.js';

export class LiquidityReserveHelper {
    public liquidity: bigint;
    public reservedLiquidity: bigint;
    public virtualBTCReserve: bigint;
    public virtualTokenReserve: bigint;

    constructor(public tokenHelper: TokenHelper) {
        this.liquidity = 0n;
        this.reservedLiquidity = 0n;
        this.virtualBTCReserve = 0n;
        this.virtualTokenReserve = 0n;
    }

    public static async create(
        nativeSwap: NativeSwap,
        tokenHelper: TokenHelper,
    ): Promise<LiquidityReserveHelper> {
        const reserve: LiquidityReserveHelper = new LiquidityReserveHelper(tokenHelper);
        await reserve.update(nativeSwap);

        return reserve;
    }

    public static async assertCurrentLiquidityReserve(
        nativeSwap: NativeSwap,
        tokenHelper: TokenHelper,
        liquidity: bigint,
        reservedLiquidity: bigint,
        virtualBTCReserve: bigint,
        virtualTokenReserve: bigint,
        log: boolean = false,
    ): Promise<void> {
        const reserve = await LiquidityReserveHelper.create(nativeSwap, tokenHelper);

        if (log) {
            reserve.logToConsole();
        }

        Assert.expect(reserve.liquidity).toEqual(liquidity);
        Assert.expect(reserve.reservedLiquidity).toEqual(reservedLiquidity);

        //!!!!
        //Assert.expect(reserve.virtualBTCReserve).toEqual(virtualBTCReserve);

        //!!!!
        //Assert.expect(reserve.virtualTokenReserve).toEqual(virtualTokenReserve);
    }

    public async update(nativeSwap: NativeSwap): Promise<void> {
        const result = await nativeSwap.getReserve({
            token: this.tokenHelper.token.address,
        });

        this.liquidity = result.liquidity;
        this.reservedLiquidity = result.reservedLiquidity;
        this.virtualBTCReserve = result.virtualBTCReserve;
        this.virtualTokenReserve = result.virtualTokenReserve;
    }

    public logToConsole(): void {
        Blockchain.log('RESERVE INFO');
        Blockchain.log('----------');
        Blockchain.log(`name: ${this.tokenHelper.name}`);
        Blockchain.log(`address: ${this.tokenHelper.token.address}`);
        Blockchain.log(`liquidity: ${this.liquidity}`);
        Blockchain.log(`reservedLiquidity: ${this.reservedLiquidity}`);
        Blockchain.log(`virtualBTCReserve: ${this.virtualBTCReserve}`);
        Blockchain.log(`virtualTokenReserve: ${this.virtualTokenReserve}`);
        Blockchain.log('');
    }
}
