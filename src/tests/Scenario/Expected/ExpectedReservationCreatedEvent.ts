import { BaseExpectedEvent } from './BaseExpectedEvent.js';
import { Assert } from '@btc-vision/unit-test-framework';
import { IReservationCreatedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedReservationCreatedEvent extends BaseExpectedEvent<IReservationCreatedEvent> {
    public readonly expectedAmountOut: bigint;
    public readonly totalSatoshis: bigint;

    constructor(expectedAmountOut: bigint, totalSatoshis: bigint) {
        super('ReservationCreatedEvent');
        this.expectedAmountOut = expectedAmountOut;
        this.totalSatoshis = totalSatoshis;
    }

    public validate(actualEvent: IReservationCreatedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.expectedAmountOut).toEqual(this.expectedAmountOut);
        Assert.expect(actualEvent.totalSatoshis).toEqual(this.totalSatoshis);
    }
}
