import {
    IActivateProviderEvent,
    IProviderConsumedEvent,
    IProviderFulfilledEvent,
    IReservationFallbackEvent,
    ISwapExecutedEvent,
    ITransferEvent,
} from '../../../contracts/NativeSwapTypes.js';
import { NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';

export class SwapEventsHelper {
    public swapExecutedEvent: ISwapExecutedEvent | null = null;
    public reservationFallbackEvent: IReservationFallbackEvent | null = null;
    public transferredEvents: ITransferEvent[] = [];
    public providerFulfilledEvents: IProviderFulfilledEvent[] = [];
    public providerActivatedEvent: IActivateProviderEvent[] = [];
    public providerConsumedEvent: IProviderConsumedEvent[] = [];
}

export function decodeSwapEventsHelper(events: NetEvent[]): SwapEventsHelper {
    const result: SwapEventsHelper = new SwapEventsHelper();

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'Transferred': {
                result.transferredEvents.push(
                    NativeSwapTypesCoders.decodeTransferEvent(event.data),
                );
                break;
            }
            case 'SwapExecuted': {
                result.swapExecutedEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                    event.data,
                );
                break;
            }
            case 'ProviderActivated': {
                result.providerActivatedEvent.push(
                    NativeSwapTypesCoders.decodeActivateProviderEvent(event.data),
                );
                break;
            }

            case 'ProviderFulfilled': {
                result.providerFulfilledEvents.push(
                    NativeSwapTypesCoders.decodeProviderFulfilledEvent(event.data),
                );
                break;
            }
            case 'ReservationFallback': {
                result.reservationFallbackEvent =
                    NativeSwapTypesCoders.decodeReservationFallbackEvent(event.data);
                break;
            }
            case 'ProviderConsumed': {
                result.providerConsumedEvent.push(
                    NativeSwapTypesCoders.decodeProviderConsumedEvent(event.data),
                );
                break;
            }
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }

    return result;
}
