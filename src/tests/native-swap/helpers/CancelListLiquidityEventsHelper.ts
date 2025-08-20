import {
    IProviderFulfilledEvent,
    IListingCanceledEvent,
    IReservationPurgedEvent,
    ITransferEvent,
} from '../../../contracts/NativeSwapTypes.js';
import { Address, NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { ProviderHelper } from './ProviderHelper.js';
import { Assert } from '@btc-vision/unit-test-framework';

export class CancelListLiquidityEventsHelper {
    public providerFulfilledEvents: IProviderFulfilledEvent[] = [];
    public listingCancelledEvent: IListingCanceledEvent | null = null;
    public transferredEvents: ITransferEvent[] = [];
    public purgedReservationEvents: IReservationPurgedEvent[] = [];
}

export function decodeCancelListLiquidityEventsHelper(
    events: NetEvent[],
): CancelListLiquidityEventsHelper {
    const result: CancelListLiquidityEventsHelper = new CancelListLiquidityEventsHelper();

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'ProviderFulfilled':
                result.providerFulfilledEvents.push(
                    NativeSwapTypesCoders.decodeProviderFulfilledEvent(event.data),
                );
                break;
            case 'Transferred': {
                result.transferredEvents.push(
                    NativeSwapTypesCoders.decodeTransferEvent(event.data),
                );
                break;
            }
            case 'ListingCanceled': {
                result.listingCancelledEvent = NativeSwapTypesCoders.decodeCancelListingEvent(
                    event.data,
                );

                break;
            }
            case 'ReservationPurged':
                result.purgedReservationEvents.push(
                    NativeSwapTypesCoders.decodeReservationPurgedEvent(event.data),
                );
                break;
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }

    return result;
}

export function assertCancelListLiquidityEventsHelper(
    nativeSwapContractAddress: Address,
    stakingContractAddress: Address,
    provider: ProviderHelper,
    events: CancelListLiquidityEventsHelper,
): void {
    Assert.expect(events.providerFulfilledEvents).toBeGreaterThan(0);
    Assert.expect(events.listingCancelledEvent).toNotEqual(null);

    Assert.expect(
        events.providerFulfilledEvents.find((p) => p.providerId === provider.id),
    ).toBeDefined();

    if (events.listingCancelledEvent !== null) {
        Assert.expect(events.listingCancelledEvent.amount).toEqual(provider.liquidity);

        Assert.expect(events.transferredEvents.length).toEqual(
            events.listingCancelledEvent.penalty > 0 ? 2 : 1,
        );

        Assert.expect(events.transferredEvents[0].amount).toEqual(
            provider.liquidity - events.listingCancelledEvent.penalty,
        );
        Assert.expect(events.transferredEvents[0].from.toString()).toEqual(
            nativeSwapContractAddress.toString(),
        );
        Assert.expect(events.transferredEvents[0].to.toString()).toEqual(
            provider.address.toString(),
        );

        if (events.transferredEvents.length === 2) {
            Assert.expect(events.transferredEvents[1].amount).toEqual(
                events.listingCancelledEvent.penalty,
            );
            Assert.expect(events.transferredEvents[1].from.toString()).toEqual(
                nativeSwapContractAddress.toString(),
            );
            Assert.expect(events.transferredEvents[1].to.toString()).toEqual(
                stakingContractAddress.toString(),
            );
        }
    }
}
