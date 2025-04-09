import { ExpectedApprovedEvent } from './Expected/ExpectedApprovedEvent.js';
import { ExpectedLiquidityRemovedEvent } from './Expected/ExpectedLiquidityRemovedEvent.js';
import { ExpectedLiquidityAddedEvent } from './Expected/ExpectedLiquidityAddedEvent.js';
import { ExpectedLiquidityReservedEvent } from './Expected/ExpectedLiquidityReservedEvent.js';
import { ExpectedReservationCreatedEvent } from './Expected/ExpectedReservationCreatedEvent.js';
import { ExpectedSwapExecutedEvent } from './Expected/ExpectedSwapExecutedEvent.js';
import { ExpectedLiquidityListedEvent } from './Expected/ExpectedLiquidityListedEvent.js';
import { Address } from '@btc-vision/transaction';
import { ExpectedTransferEvent } from './Expected/ExpectedTransferEvent.js';
import { ExpectedListingCanceledEvent } from './Expected/ExpectedListingCanceledEvent.js';
import { ExpectedFulfilledProviderEvent } from './Expected/ExpectedFulfilledProviderEvent.js';
import { ExpectedActivateProviderEvent } from './Expected/ExpectedActivateProviderEvent.js';

export interface JSonLiquidityAddedEvent {
    eventName: 'LiquidityAddedEvent';
    totalTokensContributed: string;
    virtualTokenExchanged: string;
    totalSatoshisSpent: string;
}

export interface JSonLiquidityListedEvent {
    eventName: 'LiquidityListedEvent';
    readonly totalLiquidity: string;
    readonly provider: string;
}

export interface JSonLiquidityRemovedEvent {
    eventName: 'LiquidityRemovedEvent';
    readonly providerId: string;
    readonly btcOwed: string;
    readonly tokenAmount: string;
}

export interface JSonLiquidityReservedEvent {
    eventName: 'LiquidityReservedEvent';
    readonly depositAddress: string;
    readonly amount: string;
    readonly providerId: string;
}

export interface JSonReservationCreatedEvent {
    eventName: 'ReservationCreatedEvent';
    readonly expectedAmountOut: string;
    readonly totalSatoshis: string;
}

export interface JSonSwapExecutedEvent {
    eventName: 'SwapExecutedEvent';
    readonly buyer: string;
    readonly amountIn: string;
    readonly amountOut: string;
}

export interface JSonApprovedEvent {
    eventName: 'ApprovedEvent';
    readonly owner: string;
    readonly spender: string;
    readonly value: string;
}

export interface JSonTransferEvent {
    eventName: 'TransferEvent';
    readonly from: string;
    readonly to: string;
    readonly amount: string;
}

export interface JSonListingCanceledEvent {
    eventName: 'ListingCanceledEvent';
    readonly amount: string;
}

export interface JSonActivateProviderEvent {
    eventName: 'ActivateProviderEvent';
    readonly providerId: string;
    readonly listingAmount: string;
    readonly btcToRemove: string;
}

export interface JSonFulfilledProviderEvent {
    eventName: 'FulfilledProviderEvent';
    readonly providerId: string;
    readonly canceled: string;
    readonly removalCompleted: string;
}

export type JSonExpectedEvent =
    | JSonLiquidityAddedEvent
    | JSonLiquidityListedEvent
    | JSonLiquidityRemovedEvent
    | JSonLiquidityReservedEvent
    | JSonReservationCreatedEvent
    | JSonSwapExecutedEvent
    | JSonApprovedEvent
    | JSonTransferEvent
    | JSonListingCanceledEvent
    | JSonActivateProviderEvent
    | JSonFulfilledProviderEvent;

export type ExpectedEvent =
    | ExpectedLiquidityAddedEvent
    | ExpectedLiquidityListedEvent
    | ExpectedLiquidityRemovedEvent
    | ExpectedApprovedEvent
    | ExpectedLiquidityReservedEvent
    | ExpectedReservationCreatedEvent
    | ExpectedSwapExecutedEvent
    | ExpectedTransferEvent
    | ExpectedListingCanceledEvent
    | ExpectedFulfilledProviderEvent
    | ExpectedActivateProviderEvent;

export function parseExpectedEvent(raw: JSonExpectedEvent): ExpectedEvent {
    switch (raw.eventName) {
        case 'LiquidityAddedEvent': {
            const r = raw;
            return new ExpectedLiquidityAddedEvent(
                BigInt(r.totalTokensContributed),
                BigInt(r.virtualTokenExchanged),
                BigInt(r.totalSatoshisSpent),
            );
        }
        case 'LiquidityListedEvent': {
            const r = raw;
            return new ExpectedLiquidityListedEvent(BigInt(r.totalLiquidity), r.provider);
        }

        case 'LiquidityReservedEvent': {
            const r = raw;
            return new ExpectedLiquidityReservedEvent(
                r.depositAddress,
                BigInt(r.amount),
                BigInt(r.providerId),
            );
        }
        case 'LiquidityRemovedEvent': {
            const r = raw;
            return new ExpectedLiquidityRemovedEvent(
                BigInt(r.providerId),
                BigInt(r.btcOwed),
                BigInt(r.tokenAmount),
            );
        }
        case 'ReservationCreatedEvent': {
            const r = raw;
            return new ExpectedReservationCreatedEvent(
                BigInt(r.expectedAmountOut),
                BigInt(r.totalSatoshis),
            );
        }
        case 'SwapExecutedEvent': {
            const r = raw;
            return new ExpectedSwapExecutedEvent(
                Address.fromString(r.buyer),
                BigInt(r.amountIn),
                BigInt(r.amountOut),
            );
        }
        case 'ApprovedEvent': {
            const r = raw;
            return new ExpectedApprovedEvent(
                Address.fromString(r.owner),
                Address.fromString(r.spender),
                BigInt(r.value),
            );
        }

        case 'TransferEvent': {
            const r = raw;
            return new ExpectedTransferEvent(
                Address.fromString(r.from),
                Address.fromString(r.to),
                BigInt(r.amount),
            );
        }
        case 'ListingCanceledEvent': {
            const r = raw;
            return new ExpectedListingCanceledEvent(BigInt(r.amount));
        }
        case 'FulfilledProviderEvent': {
            const r = raw;
            return new ExpectedFulfilledProviderEvent(
                BigInt(r.providerId),
                r.canceled === 'true',
                r.removalCompleted === 'true',
            );
        }
        case 'ActivateProviderEvent': {
            const r = raw;
            return new ExpectedActivateProviderEvent(
                BigInt(r.providerId),
                BigInt(r.listingAmount),
                BigInt(r.btcToRemove),
            );
        }

        default:
            throw new Error('Unsupported eventName');
    }
}
