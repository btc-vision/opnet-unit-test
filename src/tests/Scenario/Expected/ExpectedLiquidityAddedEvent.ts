import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { ILiquidityAddedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedLiquidityAddedEvent extends BaseExpectedEvent<ILiquidityAddedEvent> {
    public readonly totalTokensContributed: bigint;
    public readonly virtualTokenExchanged: bigint;
    public readonly totalSatoshisSpent: bigint;

    constructor(
        totalTokensContributed: bigint,
        virtualTokenExchanged: bigint,
        totalSatoshisSpent: bigint,
    ) {
        super('LiquidityAddedEvent');
        this.totalTokensContributed = totalTokensContributed;
        this.virtualTokenExchanged = virtualTokenExchanged;
        this.totalSatoshisSpent = totalSatoshisSpent;
    }

    public validate(actualEvent: ILiquidityAddedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.totalTokensContributed).toEqual(this.totalTokensContributed);
        Assert.expect(actualEvent.virtualTokenExchanged).toEqual(this.virtualTokenExchanged);
        Assert.expect(actualEvent.totalSatoshisSpent).toEqual(this.totalSatoshisSpent);
    }
}
