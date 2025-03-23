import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { ILiquidityReservedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedLiquidityReservedEvent extends BaseExpectedEvent<ILiquidityReservedEvent> {
    public readonly depositAddress: string;
    public readonly amount: bigint;
    public readonly providerId: bigint;

    constructor(depositAddress: string, amount: bigint, providerId: bigint) {
        super('LiquidityReservedEvent');
        this.depositAddress = depositAddress;
        this.amount = amount;
        this.providerId = providerId;
    }

    public validate(actualEvent: ILiquidityReservedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.depositAddress).toEqual(this.depositAddress);
        Assert.expect(actualEvent.amount).toEqual(this.amount);
        Assert.expect(actualEvent.providerId).toEqual(this.providerId);
    }
}
