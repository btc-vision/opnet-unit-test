import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IFulfilledProviderEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedFulfilledProviderEvent extends BaseExpectedEvent<IFulfilledProviderEvent> {
    public readonly providerId: bigint;
    public readonly canceled: boolean;
    public readonly removalCompleted: boolean;

    constructor(providerId: bigint, canceled: boolean, removalCompleted: boolean) {
        super('FulfilledProviderEvent');
        this.providerId = providerId;
        this.canceled = canceled;
        this.removalCompleted = removalCompleted;
    }

    public validate(actualEvent: IFulfilledProviderEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.providerId).toEqual(this.providerId);
        Assert.expect(actualEvent.canceled).toEqual(this.canceled);
        Assert.expect(actualEvent.removalCompleted).toEqual(this.removalCompleted);
    }
}
