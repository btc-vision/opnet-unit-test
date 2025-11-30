import {
    ILiquidityListedEvent,
    IProviderFulfilledEvent,
    IReservationPurgedEvent,
    ITransferEvent,
} from '../../../contracts/NativeSwapTypes.js';
import { Address, NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { ProviderHelper } from './ProviderHelper.js';
import { Assert, Blockchain } from '@btc-vision/unit-test-framework';
import { CSV_DURATION } from '../../globals.js';
import {
    logLiquidityListedEvent,
    logProviderFulfilledEvent,
    logReservationPurgedEvent,
    logTransferEvent,
} from '../../utils/LoggerHelper.js';

export class ListLiquidityEvents {
    public transferredEvents: ITransferEvent[] = [];
    public liquidityListedEvent: ILiquidityListedEvent | null = null;
    public purgedReservationEvents: IReservationPurgedEvent[] = [];
    public providerFulfilledEvents: IProviderFulfilledEvent[] = [];

    public logToConsole(): void {
        Blockchain.log('LIST LIQUIDITY INFO');
        Blockchain.log('----------');
        if (this.liquidityListedEvent !== null) {
            logLiquidityListedEvent(this.liquidityListedEvent);
        }

        for (let i = 0; i < this.transferredEvents.length; i++) {
            logTransferEvent(this.transferredEvents[i]);
        }
        for (let i = 0; i < this.purgedReservationEvents.length; i++) {
            logReservationPurgedEvent(this.purgedReservationEvents[i]);
        }
        for (let i = 0; i < this.providerFulfilledEvents.length; i++) {
            logProviderFulfilledEvent(this.providerFulfilledEvents[i]);
        }
    }
}

export class ListLiquidityEventsHelper {
    public static decodeListLiquidityEvents(events: NetEvent[]): ListLiquidityEvents {
        const result: ListLiquidityEvents = new ListLiquidityEvents();

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
                    result.transferredEvents.push(
                        NativeSwapTypesCoders.decodeTransferEvent(event.data),
                    );

                    break;
                }
                case 'ReservationPurged':
                    result.purgedReservationEvents.push(
                        NativeSwapTypesCoders.decodeReservationPurgedEvent(event.data),
                    );
                    break;
                case 'ProviderFulfilled':
                    result.providerFulfilledEvents.push(
                        NativeSwapTypesCoders.decodeProviderFulfilledEvent(event.data),
                    );
                    break;
                default: {
                    throw new Error(`Unknown event type: ${event.type}`);
                }
            }
        }

        return result;
    }

    public static assertListLiquidityEvents(
        nativeSwapContractAddress: Address,
        stakingContractAddress: Address,
        provider: ProviderHelper,
        amountIn: bigint,
        tax: bigint,
        events: ListLiquidityEvents,
    ): void {
        Assert.expect(events.transferredEvents.length).toEqual(provider.isPriority ? 2 : 1);
        Assert.expect(events.liquidityListedEvent).toNotEqual(null);

        Assert.expect(events.transferredEvents[0].from.toString()).toEqual(
            provider.address.toString(),
        );
        Assert.expect(events.transferredEvents[0].to.toString()).toEqual(
            nativeSwapContractAddress.toString(),
        );
        Assert.expect(events.transferredEvents[0].amount).toEqual(amountIn);

        if (provider.isPriority) {
            Assert.expect(events.transferredEvents[1].from.toString()).toEqual(
                nativeSwapContractAddress.toString(),
            );
            Assert.expect(events.transferredEvents[1].to.toString()).toEqual(
                stakingContractAddress.toString(),
            );
            Assert.expect(events.transferredEvents[1].amount).toEqual(tax);
        }

        if (events.liquidityListedEvent !== null) {
            Assert.expect(events.liquidityListedEvent.totalLiquidity).toEqual(
                provider.liquidity + amountIn - tax,
            );
            Assert.expect(events.liquidityListedEvent.provider).toEqual(
                provider.address.toCSV(CSV_DURATION, Blockchain.network).address,
            );
        }
    }
}
