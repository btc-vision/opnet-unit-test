import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IFulfilledProviderEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedFulfilledProviderEvent extends BaseExpectedEvent<IFulfilledProviderEvent> {
    public readonly providerId: bigint;

    constructor(providerId: bigint) {
        super('FulfilledProviderEvent');
        this.providerId = providerId;
    }

    public validate(actualEvent: IFulfilledProviderEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.providerId).toEqual(this.providerId);
    }
}
