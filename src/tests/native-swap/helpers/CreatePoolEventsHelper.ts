import { ILiquidityListedEvent, ITransferEvent } from '../../../contracts/NativeSwapTypes.js';
import { Address, NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { ProviderHelper } from './ProviderHelper.js';
import { Assert, Blockchain } from '@btc-vision/unit-test-framework';
import { CSV_DURATION } from '../../globals.js';

export class CreatePoolEventsHelper {
    public transferredEvent: ITransferEvent | null = null;
    public liquidityListedEvent: ILiquidityListedEvent | null = null;
}

export function decodeCreatePoolEventsHelper(events: NetEvent[]): CreatePoolEventsHelper {
    const result: CreatePoolEventsHelper = new CreatePoolEventsHelper();

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'LiquidityListed': {
                result.liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                    event.data,
                );

                break;
            }
            case 'Transferred': {
                result.transferredEvent = NativeSwapTypesCoders.decodeTransferEvent(event.data);

                break;
            }
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }

    return result;
}

export function assertCreatePoolEventsHelper(
    nativeSwapContractAddress: Address,
    provider: ProviderHelper,
    amountIn: bigint,
    events: CreatePoolEventsHelper,
): void {
    Assert.expect(events.transferredEvent).toNotEqual(null);
    Assert.expect(events.liquidityListedEvent).toNotEqual(null);

    if (events.transferredEvent !== null) {
        Assert.expect(events.transferredEvent.from.toString()).toEqual(provider.address.toString());
        Assert.expect(events.transferredEvent.to.toString()).toEqual(
            nativeSwapContractAddress.toString(),
        );
        Assert.expect(events.transferredEvent.amount).toEqual(amountIn);
    }

    if (events.liquidityListedEvent !== null) {
        Assert.expect(events.liquidityListedEvent.totalLiquidity).toEqual(amountIn);
        Assert.expect(events.liquidityListedEvent.provider).toEqual(
            provider.address.toCSV(CSV_DURATION, Blockchain.network).address,
        );
    }
}
