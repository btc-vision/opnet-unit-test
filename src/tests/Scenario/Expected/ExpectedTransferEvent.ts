import { Address } from '@btc-vision/transaction';
import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { ITransferEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedTransferEvent extends BaseExpectedEvent<ITransferEvent> {
    public readonly from: Address;
    public readonly to: Address;
    public readonly amount: bigint;

    constructor(from: Address, to: Address, amount: bigint) {
        super('TransferEvent');
        this.from = from;
        this.to = to;
        this.amount = amount;
    }

    public validate(actualEvent: ITransferEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.from.toString()).toEqual(this.from.toString());
        Assert.expect(actualEvent.to.toString()).toEqual(this.to.toString());
        Assert.expect(actualEvent.amount).toEqual(this.amount);
    }
}
