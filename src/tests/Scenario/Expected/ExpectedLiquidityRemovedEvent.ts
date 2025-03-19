import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { ILiquidityRemovedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedLiquidityRemovedEvent extends BaseExpectedEvent<ILiquidityRemovedEvent> {
    public readonly providerId: bigint;
    public readonly btcOwed: bigint;
    public readonly tokenAmount: bigint;

    constructor(providerId: bigint, btcOwed: bigint, tokenAmount: bigint) {
        super('LiquidityRemovedEvent');
        this.providerId = providerId;
        this.btcOwed = btcOwed;
        this.tokenAmount = tokenAmount;
    }

    public validate(actualEvent: ILiquidityRemovedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.providerId).toEqual(this.providerId);
        Assert.expect(actualEvent.btcOwed).toEqual(this.btcOwed);
        Assert.expect(actualEvent.tokenAmount).toEqual(this.tokenAmount);
    }
}
