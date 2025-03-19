import { BaseExpectedEvent } from './BaseExpectedEvent';
import { Address } from '@btc-vision/transaction';
import { Assert } from '@btc-vision/unit-test-framework';
import { ISwapExecutedEvent } from '../../../contracts/NativeSwapTypes.js';

export class ExpectedSwapExecutedEvent extends BaseExpectedEvent<ISwapExecutedEvent> {
    public readonly buyer: Address;
    public readonly amountIn: bigint;
    public readonly amountOut: bigint;

    constructor(buyer: Address, amountIn: bigint, amountOut: bigint) {
        super('SwapExecutedEvent');
        this.buyer = buyer;
        this.amountIn = amountIn;
        this.amountOut = amountOut;
    }

    public validate(actualEvent: ISwapExecutedEvent): void {
        Assert.expect(actualEvent.name).toEqual(this.eventName);
        Assert.expect(actualEvent.buyer.toString()).toEqual(this.buyer.toString());
        Assert.expect(actualEvent.amountIn).toEqual(this.amountIn);
        Assert.expect(actualEvent.amountOut).toEqual(this.amountOut);
    }
}
