import {
    Blockchain,
    CallResponse,
    gas2BTC,
    gas2Sat,
    gas2USD,
} from '@btc-vision/unit-test-framework';
import {
    AddLiquidityResult,
    CancelListingResult,
    CreatePoolResult,
    GetProviderDetailsParams,
    GetProviderDetailsResult,
    GetQuoteResult,
    GetReserveResult,
    IActivateProviderEvent,
    IApprovedEvent,
    IFulfilledProviderEvent,
    ILiquidityAddedEvent,
    ILiquidityListedEvent,
    ILiquidityRemovedEvent,
    ILiquidityReservedEvent,
    IListingCanceledEvent,
    IReservationCreatedEvent,
    IReservationPurgedEvent,
    ISwapExecutedEvent,
    ITransferEvent,
    ListLiquidityResult,
    Recipient,
    RemoveLiquidityResult,
    ReserveResult,
    SwapResult,
} from '../../contracts/NativeSwapTypes.js';
import { NetEvent } from '@btc-vision/transaction';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';

export function logGetProviderDetailsResult(result: GetProviderDetailsResult): void {
    Blockchain.log(``);
    Blockchain.log(`GetProviderDetailsResult`);
    Blockchain.log(`----------------`);
    Blockchain.log(`id: ${result.id}`);
    Blockchain.log(`liquidity: ${result.liquidity}`);
    Blockchain.log(`reserved: ${result.reserved}`);
    Blockchain.log(`isPurged: ${result.isPurged}`);
    Blockchain.log(`isPriority: ${result.isPriority}`);
    Blockchain.log(`btcReceiver: ${result.btcReceiver}`);
    Blockchain.log(`queueIndex: ${result.queueIndex}`);
    Blockchain.log(`purgeIndex: ${result.purgeIndex}`);
    Blockchain.log(`isActive: ${result.isActive}`);
    Blockchain.log(`listedTokenAt: ${result.listedTokenAt}`);
    Blockchain.log(``);
}

export function logGetReserveResult(result: GetReserveResult): void {
    Blockchain.log(``);
    Blockchain.log(`GetReserveResult`);
    Blockchain.log(`----------------`);
    Blockchain.log(`liquidity: ${result.liquidity}`);
    Blockchain.log(`reservedLiquidity: ${result.reservedLiquidity}`);
    Blockchain.log(`virtualBTCReserve: ${result.virtualBTCReserve}`);
    Blockchain.log(`virtualTokenReserve: ${result.virtualTokenReserve}`);
    Blockchain.log(``);
}

export function logReserveResult(result: ReserveResult): void {
    Blockchain.log(``);
    Blockchain.log(`ReserveResult`);
    Blockchain.log(`-------------`);
    Blockchain.log(`totalSatoshis: ${result.totalSatoshis}`);
    Blockchain.log(`expectedAmountOut: ${result.expectedAmountOut}`);
    logGas(result.response);
    Blockchain.log(``);
}

export function logSwapResult(result: SwapResult): void {
    Blockchain.log(``);
    Blockchain.log(`SwapResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`status: ${result.response.status}`);
    logGas(result.response);
    Blockchain.log(``);
}

export function logListLiquidityResult(result: ListLiquidityResult): void {
    Blockchain.log(``);
    Blockchain.log(`ListLiquidityResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`status: ${result.response.status}`);
    Blockchain.log(``);
}

export function logCreatePoolResult(result: CreatePoolResult): void {
    Blockchain.log(``);
    Blockchain.log(`CreatePoolResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`status: ${result.response.status}`);
    logGas(result.response);
    Blockchain.log(``);
}

export function logAddLiquidityResult(result: AddLiquidityResult): void {
    Blockchain.log(``);
    Blockchain.log(`AddLiquidityResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`status: ${result.response.status}`);
    Blockchain.log(``);
}

export function logRemoveLiquidityResult(result: RemoveLiquidityResult): void {
    Blockchain.log(``);
    Blockchain.log(`RemoveLiquidityResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`status: ${result.response.status}`);
    Blockchain.log(``);
}

export function logCancelListingResult(result: CancelListingResult): void {
    Blockchain.log(``);
    Blockchain.log(`CancelListingResult`);
    Blockchain.log(`----------`);
    logGas(result.response);
    Blockchain.log(``);
}

export function logGetQuoteResult(result: GetQuoteResult): void {
    Blockchain.log(``);
    Blockchain.log(`GetQuoteResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`tokensOut: ${result.tokensOut}`);
    Blockchain.log(`price: ${result.price}`);
    Blockchain.log(`requiredSatoshis: ${result.requiredSatoshis}`);
    Blockchain.log(``);
}

export function logSwapExecutedEvent(event: ISwapExecutedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`SwapExecutedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`amountIn: ${event.amountIn}`);
    Blockchain.log(`amountOut: ${event.amountOut}`);
    Blockchain.log(`buyer: ${event.buyer}`);

    Blockchain.log(``);
}

export function logLiquidityAddedEvent(event: ILiquidityAddedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`LiquidityAddedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`totalSatoshisSpent: ${event.totalSatoshisSpent}`);
    Blockchain.log(`totalTokensContributed: ${event.totalTokensContributed}`);
    Blockchain.log(`virtualTokenExchanged: ${event.virtualTokenExchanged}`);
    Blockchain.log(``);
}

export function logLiquidityRemovedEvent(event: ILiquidityRemovedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`LiquidityRemovedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`satoshisOwed: ${event.satoshisOwed}`);
    Blockchain.log(`tokenAmount: ${event.tokenAmount}`);
    Blockchain.log(`providerId: ${event.providerId}`);
    Blockchain.log(``);
}

export function logListingCanceledEvent(event: IListingCanceledEvent): void {
    Blockchain.log(``);
    Blockchain.log(`ListingCanceledEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`amount: ${event.amount}`);
    Blockchain.log(`penalty: ${event.penalty}`);

    Blockchain.log(``);
}

export function logSwapEvents(events: NetEvent[]): void {
    Blockchain.log(``);
    Blockchain.log(`SwapEvents`);
    Blockchain.log(`-----------------`);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'Transferred': {
                logTransferEvent(NativeSwapTypesCoders.decodeTransferEvent(event.data));
                break;
            }
            case 'SwapExecuted': {
                logSwapExecutedEvent(NativeSwapTypesCoders.decodeSwapExecutedEvent(event.data));
                break;
            }
            case 'ActivateProvider': {
                logActivateProviderEvent(
                    NativeSwapTypesCoders.decodeActivateProviderEvent(event.data),
                );
                break;
            }

            case 'ProviderFulfilled': {
                logFulfilledProviderEvent(
                    NativeSwapTypesCoders.decodeFulfilledProviderEvent(event.data),
                );
                break;
            }
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }

    Blockchain.log(``);
}

export function logAddLiquidityEvents(events: NetEvent[]): void {
    Blockchain.log(``);
    Blockchain.log(`AddLiquidityEvents`);
    Blockchain.log(`-----------------`);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'Transferred': {
                logTransferEvent(NativeSwapTypesCoders.decodeTransferEvent(event.data));
                break;
            }
            case 'LiquidityAdded': {
                logLiquidityAddedEvent(NativeSwapTypesCoders.decodeLiquidityAddedEvent(event.data));
                break;
            }
            case 'ProviderFulfilled':
                logFulfilledProviderEvent(
                    NativeSwapTypesCoders.decodeFulfilledProviderEvent(event.data),
                );
                break;
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }
    Blockchain.log(``);
}

export function logRemoveLiquidityEvents(events: NetEvent[]): void {
    Blockchain.log(``);
    Blockchain.log(`RemoveLiquidityEvents`);
    Blockchain.log(`-----------------`);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'Transferred': {
                logTransferEvent(NativeSwapTypesCoders.decodeTransferEvent(event.data));
                break;
            }
            case 'LiquidityRemoved': {
                logLiquidityRemovedEvent(
                    NativeSwapTypesCoders.decodeLiquidityRemovedEvent(event.data),
                );
                break;
            }
            case 'ActivateProvider': {
                logActivateProviderEvent(
                    NativeSwapTypesCoders.decodeActivateProviderEvent(event.data),
                );
                break;
            }
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }
    Blockchain.log(``);
}

export function logCancelListingEvents(events: NetEvent[]): void {
    Blockchain.log(``);
    Blockchain.log(`CancelListingEvents`);
    Blockchain.log(`-----------------`);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'ProviderFulfilled':
                logFulfilledProviderEvent(
                    NativeSwapTypesCoders.decodeFulfilledProviderEvent(event.data),
                );
                break;
            case 'Transferred': {
                logTransferEvent(NativeSwapTypesCoders.decodeTransferEvent(event.data));
                break;
            }
            case 'ListingCanceled': {
                logListingCanceledEvent(NativeSwapTypesCoders.decodeCancelListingEvent(event.data));
                break;
            }
            case 'ReservationPurged':
                logReservationPurgedEvent(
                    NativeSwapTypesCoders.decodeReservationPurgedEvent(event.data),
                );
                break;
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }
    Blockchain.log(``);
}

export function logActivateProviderEvent(event: IActivateProviderEvent): void {
    Blockchain.log(``);
    Blockchain.log(`ActivateProviderEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`providerId: ${event.providerId}`);
    Blockchain.log(`listingAmount: ${event.listingAmount}`);
    Blockchain.log(`btcToRemove: ${event.btcToRemove}`);
    Blockchain.log(``);
}

export function logFulfilledProviderEvent(event: IFulfilledProviderEvent): void {
    Blockchain.log(``);
    Blockchain.log(`ProviderFulfilledEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`providerId: ${event.providerId}`);
    Blockchain.log(`canceled: ${event.canceled}`);
    Blockchain.log(`removalCompleted: ${event.removalCompleted}`);
    Blockchain.log(``);
}

export function logReservationCreatedEvent(event: IReservationCreatedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`ReservationCreatedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`expectedAmountOut: ${event.expectedAmountOut}`);
    Blockchain.log(`totalSatoshis: ${event.totalSatoshis}`);
    Blockchain.log(``);
}

export function logReservationPurgedEvent(event: IReservationPurgedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`ReservationPurgedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`reservationId: ${event.reservationId}`);
    Blockchain.log(`currentBlock: ${event.currentBlock}`);
    Blockchain.log(`purgingBlock: ${event.purgingBlock}`);
    Blockchain.log(`purgeIndex: ${event.purgeIndex}`);
    Blockchain.log(`providerCount: ${event.providerCount}`);
    Blockchain.log(``);
}

export function logApprovedExecutedEvent(event: IApprovedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`ApprovedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`owner: ${event.owner}`);
    Blockchain.log(`spender: ${event.spender}`);
    Blockchain.log(`value: ${event.value}`);
    Blockchain.log(``);
}

export function logTransferEvent(event: ITransferEvent): void {
    Blockchain.log(``);
    Blockchain.log(`TransferEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`from: ${event.from}`);
    Blockchain.log(`to: ${event.to}`);
    Blockchain.log(`amount: ${event.amount}`);
    Blockchain.log(``);
}

export function logLiquidityListedEvent(event: ILiquidityListedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`LiquidityListedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`totalLiquidity: ${event.totalLiquidity}`);
    Blockchain.log(`provider: ${event.provider}`);
    Blockchain.log(``);
}

export function logLiquidityReservedEvent(event: ILiquidityReservedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`LiquidityReservedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`amount: ${event.amount}`);
    Blockchain.log(`depositAddress: ${event.depositAddress}`);
    Blockchain.log(`providerId: ${event.providerId}`);
    Blockchain.log(``);
}

export function logListLiquidityEvent(events: NetEvent[]): void {
    Blockchain.log(``);
    Blockchain.log(`ListLiquidityEvents`);
    Blockchain.log(`-------------------`);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'LiquidityListed': {
                logLiquidityListedEvent(
                    NativeSwapTypesCoders.decodeLiquidityListedEvent(event.data),
                );
                break;
            }
            case 'Transferred': {
                logTransferEvent(NativeSwapTypesCoders.decodeTransferEvent(event.data));
                break;
            }
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }
    Blockchain.log(``);
}

export function logReserveEvent(events: NetEvent[]): void {
    Blockchain.log(``);
    Blockchain.log(`ReserveEvents`);
    Blockchain.log(`-----------------`);
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.type) {
            case 'LiquidityReserved': {
                logLiquidityReservedEvent(
                    NativeSwapTypesCoders.decodeLiquidityReservedEvent(event.data),
                );
                break;
            }
            case 'ReservationCreated': {
                logReservationCreatedEvent(
                    NativeSwapTypesCoders.decodeReservationCreatedEvent(event.data),
                );
                break;
            }
            case 'ReservationPurged':
                logReservationPurgedEvent(
                    NativeSwapTypesCoders.decodeReservationPurgedEvent(event.data),
                );
                break;
            default: {
                throw new Error(`Unknown event type: ${event.type}`);
            }
        }
    }
    Blockchain.log(``);
}

export function logBeginSection(name: string): void {
    Blockchain.log(``);
    Blockchain.log(`###################### Begin ${name} ###########################`);
    Blockchain.log(``);
}

export function logEndSection(name: string): void {
    Blockchain.log(``);
    Blockchain.log(`###################### End ${name} ###########################`);
    Blockchain.log(``);
}

export function logAction(name: string): void {
    Blockchain.log(``);
    Blockchain.log(`>>> Action: ${name} <<<`);
    logBlockchainInfo();
}

export function logParameter(name: string, value: string): void {
    Blockchain.log(`    ${name}: ${value}`);
}

export function logBlockchainInfo(): void {
    Blockchain.log(`    BlockNumber: ${Blockchain.blockNumber}`);
    Blockchain.log(`    txOrigin: ${Blockchain.txOrigin}`);
    Blockchain.log(`    msgSender: ${Blockchain.msgSender}`);
}

export function logRecipient(recipient: Recipient) {
    Blockchain.log(``);
    Blockchain.log(`Recipient`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`address: ${recipient.address}`);
    Blockchain.log(`amount: ${recipient.amount}`);
    Blockchain.log(`providerId: ${recipient.providerId}`);
    Blockchain.log(``);
}

export function logCallResponse(result: CallResponse): void {
    Blockchain.log(``);
    Blockchain.log(`CallResponse`);
    Blockchain.log(`----------`);
    Blockchain.log(`usedGas: ${result.usedGas}`);
    Blockchain.log(`status: ${result.status}`);
    Blockchain.log(`events: ${result.events.length} event(s)`);
    for (let i = 0; i < result.events.length; i++) {
        Blockchain.log(`event type ${i}: ${result.events[i].type}`);
    }

    Blockchain.log(``);
}

export function logApproveResponse(result: CallResponse): void {
    Blockchain.log(``);
    Blockchain.log(`ApproveResponse`);
    Blockchain.log(`----------`);
    Blockchain.log(`status: ${result.status}`);

    Blockchain.log(``);
}

export function logGas(response: CallResponse): void {
    Blockchain.log(
        `Gas cost: ${gas2Sat(response.usedGas)} sat (${gas2BTC(
            response.usedGas,
        )} BTC, $${gas2USD(response.usedGas)})`,
    );
}

export function logProviderDetailsResult(result: GetProviderDetailsResult): void {
    Blockchain.log(``);
    console.log(`Provider details result`);
    console.log(`---------------------`);
    console.log(`id: ${result.id}`);
    console.log(`liquidity: ${result.liquidity}`);
    console.log(`isPurged: ${result.isPurged}`);
    console.log(`purgeIndex: ${result.purgeIndex}`);
    console.log(`reserved: ${result.reserved}`);
    console.log(`listedTokenAt: ${result.listedTokenAt}`);
    console.log(`isActive: ${result.isActive}`);
    console.log(`queueIndex: ${result.queueIndex}`);
    console.log(`btcReceiver: ${result.btcReceiver}`);
    console.log(`isPriority: ${result.isPriority}`);
}
