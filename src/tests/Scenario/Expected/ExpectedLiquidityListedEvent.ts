import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { ILiquidityListedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedLiquidityListedEvent extends BaseExpectedEvent<ILiquidityListedEvent> {
    public readonly totalLiquidity: bigint;
    public readonly provider: string;

    constructor(totalLiquidity: bigint, provider: string) {
        super('LiquidityListedEvent');
        this.totalLiquidity = totalLiquidity;
        this.provider = provider;
    }

    public validate(actualEvent: ILiquidityListedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.totalLiquidity).toEqual(this.totalLiquidity);
        Assert.expect(actualEvent.provider).toEqual(this.provider);
    }
}
