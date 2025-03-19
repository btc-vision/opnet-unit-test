import { Address } from '@btc-vision/transaction';
import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IApprovedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedApprovedEvent extends BaseExpectedEvent<IApprovedEvent> {
    public readonly owner: Address;
    public readonly spender: Address;
    public readonly value: bigint;

    constructor(owner: Address, spender: Address, value: bigint) {
        super('ApprovedEvent');
        this.owner = owner;
        this.spender = spender;
        this.value = value;
    }

    public validate(actualEvent: IApprovedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.owner.toString()).toEqual(this.owner.toString());
        Assert.expect(actualEvent.spender.toString()).toEqual(this.spender.toString());
        Assert.expect(actualEvent.value).toEqual(this.value);
    }
}
