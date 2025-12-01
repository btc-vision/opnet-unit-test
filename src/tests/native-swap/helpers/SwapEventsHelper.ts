import {
    IActivateProviderEvent,
    IProviderConsumedEvent,
    IProviderFulfilledEvent,
    IReservationFallbackEvent,
    ISwapExecutedEvent,
    ITransferEvent,
} from '../../../contracts/NativeSwapTypes.js';
import { FastMap, NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { ReserveLiquidityHelper } from './ReserveLiquidityHelper.js';
import { Assert, Blockchain } from '@btc-vision/unit-test-framework';
import { ProviderSnapshotHelper } from './ProviderHelper.js';
import {
    logActivateProviderEvent,
    logProviderConsumedEvent,
    logProviderFulfilledEvent,
    logReservationFallbackEvent,
    logSwapExecutedEvent,
    logTransferEvent,
} from '../../utils/LoggerHelper.js';

export class SwapEvents {
    public swapExecutedEvent: ISwapExecutedEvent | null = null;
    public reservationFallbackEvent: IReservationFallbackEvent | null = null;
    public transferredEvents: ITransferEvent[] = [];
    public providerFulfilledEvents: IProviderFulfilledEvent[] = [];
    public providerActivatedEvent: IActivateProviderEvent[] = [];
    public providerConsumedEvent: IProviderConsumedEvent[] = [];

    public logToConsole(): void {
        Blockchain.log('SWAP INFO');
        Blockchain.log('----------');
        if (this.swapExecutedEvent !== null) {
            logSwapExecutedEvent(this.swapExecutedEvent);
        }

        if (this.reservationFallbackEvent !== null) {
            logReservationFallbackEvent(this.reservationFallbackEvent);
        }

        for (let i = 0; i < this.transferredEvents.length; i++) {
            logTransferEvent(this.transferredEvents[i]);
        }
        for (let i = 0; i < this.providerActivatedEvent.length; i++) {
            logActivateProviderEvent(this.providerActivatedEvent[i]);
        }

        for (let i = 0; i < this.providerFulfilledEvents.length; i++) {
            logProviderFulfilledEvent(this.providerFulfilledEvents[i]);
        }
        for (let i = 0; i < this.providerConsumedEvent.length; i++) {
            logProviderConsumedEvent(this.providerConsumedEvent[i]);
        }
    }
}

export class SwapEventsHelper {
    public static decodeSwapEvents(events: NetEvent[]): SwapEvents {
        const result: SwapEvents = new SwapEvents();

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

    public static assertReservedSwapperProviders(
        initialProvidersSnapshot: FastMap<bigint, ProviderSnapshotHelper>,
        finalProvidersSnapshot: FastMap<bigint, ProviderSnapshotHelper>,
        reservation: ReserveLiquidityHelper,
        swapEvents: SwapEvents,
        log: boolean = false,
    ): void {
        for (let i = 0; i < reservation.recipients.length; i++) {
            let dustResets: bigint = 0n;
            const reservedRecipient = reservation.recipients[i];
            const consumedProvider = swapEvents.providerConsumedEvent.find(
                (p) => p.providerId === reservedRecipient.providerId,
            );
            const fulfilledProvider = swapEvents.providerFulfilledEvents.find(
                (p) => p.providerId === reservedRecipient.providerId,
            );

            const initialSnapshot = initialProvidersSnapshot.get(reservedRecipient.providerId);
            const finalSnapshot = finalProvidersSnapshot.get(reservedRecipient.providerId);

            if (initialSnapshot === undefined) {
                throw new Error(
                    `Provider initial snapshot not found: ${reservedRecipient.providerId}`,
                );
            }

            if (finalSnapshot === undefined) {
                throw new Error(
                    `Provider final snapshot not found: ${reservedRecipient.providerId}`,
                );
            }

            if (fulfilledProvider !== undefined) {
                dustResets = fulfilledProvider.stakedAmount;
            }

            if (log) {
                initialSnapshot.logToConsole();
                finalSnapshot.logToConsole();
                Blockchain.log(`dust: ${dustResets}`);
            }

            if (consumedProvider !== undefined) {
                Assert.expect(finalSnapshot.reserved).toEqual(
                    initialSnapshot.reserved - reservedRecipient.tokenAmount,
                );
                Assert.expect(finalSnapshot.liquidity).toEqual(
                    initialSnapshot.liquidity - consumedProvider.amountUsed - dustResets,
                );
            } else {
                Assert.expect(finalSnapshot.reserved).toEqual(
                    initialSnapshot.reserved - reservedRecipient.tokenAmount,
                );
                Assert.expect(finalSnapshot.liquidity).toEqual(
                    initialSnapshot.liquidity - dustResets,
                );
            }
        }
    }
}
