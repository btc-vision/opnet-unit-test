import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IListingCanceledEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedListingCanceledEvent extends BaseExpectedEvent<IListingCanceledEvent> {
    public readonly amount: bigint;

    constructor(amount: bigint) {
        super('ListingCanceledEvent');
        this.amount = amount;
    }

    public validate(actualEvent: IListingCanceledEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.amount).toEqual(this.amount);
    }
}
