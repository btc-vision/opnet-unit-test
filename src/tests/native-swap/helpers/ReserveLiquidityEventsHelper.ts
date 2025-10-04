import {
    ILiquidityReservedEvent,
    IProviderFulfilledEvent,
    IReservationCreatedEvent,
    IReservationPurgedEvent,
    ITransferEvent,
} from '../../../contracts/NativeSwapTypes.js';
import { NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';

export class ReserveLiquidityEventsHelper {
    public liquidityReservedEvents: ILiquidityReservedEvent[] = [];
    public reservationCreatedEvent: IReservationCreatedEvent | null = null;
    public purgedReservationEvents: IReservationPurgedEvent[] = [];
    public transferredEvents: ITransferEvent[] = [];
    public providerFulfilledEvents: IProviderFulfilledEvent[] = [];
}

export function decodeReserveLiquidityEventsHelper(
    events: NetEvent[],
): ReserveLiquidityEventsHelper {
    const result: ReserveLiquidityEventsHelper = new ReserveLiquidityEventsHelper();

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'LiquidityReserved': {
                result.liquidityReservedEvents.push(
                    NativeSwapTypesCoders.decodeLiquidityReservedEvent(event.data),
                );
                break;
            }
            case 'ReservationCreated': {
                result.reservationCreatedEvent =
                    NativeSwapTypesCoders.decodeReservationCreatedEvent(event.data);
                break;
            }
            case 'ReservationPurged': {
                result.purgedReservationEvents.push(
                    NativeSwapTypesCoders.decodeReservationPurgedEvent(event.data),
                );

                break;
            }
            case 'Transferred': {
                result.transferredEvents.push(
                    NativeSwapTypesCoders.decodeTransferEvent(event.data),
                );
                break;
            }
            case 'ProviderFulfilled': {
                result.providerFulfilledEvents.push(
                    NativeSwapTypesCoders.decodeProviderFulfilledEvent(event.data),
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
