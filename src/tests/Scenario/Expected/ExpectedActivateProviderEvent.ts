import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IActivateProviderEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedActivateProviderEvent extends BaseExpectedEvent<IActivateProviderEvent> {
    public readonly providerId: bigint;
    public readonly listingAmount: bigint;

    constructor(providerId: bigint, listingAmount: bigint) {
        super('FulfilledProviderEvent');
        this.providerId = providerId;
        this.listingAmount = listingAmount;
    }

    public validate(actualEvent: IActivateProviderEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.providerId).toEqual(this.providerId);
        Assert.expect(actualEvent.listingAmount).toEqual(this.listingAmount);
    }
}
