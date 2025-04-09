import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IActivateProviderEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedActivateProviderEvent extends BaseExpectedEvent<IActivateProviderEvent> {
    public readonly providerId: bigint;
    public readonly listingAmount: bigint;
    public readonly btcToRemove: bigint;

    constructor(providerId: bigint, listingAmount: bigint, btcToRemove: bigint) {
        super('ActivateProviderEvent');
        this.providerId = providerId;
        this.listingAmount = listingAmount;
        this.btcToRemove = btcToRemove;
    }

    public validate(actualEvent: IActivateProviderEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.providerId).toEqual(this.providerId);
        Assert.expect(actualEvent.listingAmount).toEqual(this.listingAmount);
        Assert.expect(actualEvent.btcToRemove).toEqual(this.btcToRemove);
    }
}
