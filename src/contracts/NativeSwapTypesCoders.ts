import { Address, BinaryReader, BinaryWriter, NetEvent } from '@btc-vision/transaction';
import { CallResponse } from '@btc-vision/unit-test-framework';
import {
    AddLiquidityParams,
    AddLiquidityResult,
    CancelListingParams,
    CancelListingResult,
    CreatePoolParams,
    CreatePoolResult,
    CreatePoolWithSignatureParams,
    DecodedReservationEvents,
    GetAntibotSettingsParams,
    GetAntibotSettingsResult,
    GetFeesResult,
    GetPriorityQueueCostResult,
    GetProviderDetailsParams,
    GetProviderDetailsResult,
    GetQueueDetailsResult,
    GetQuoteParams,
    GetQuoteResult,
    GetReserveParams,
    GetReserveResult,
    GetStakingContractAddressResult,
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
    ListLiquidityParams,
    ListLiquidityResult,
    RemoveLiquidityParams,
    RemoveLiquidityResult,
    ReserveParams,
    ReserveResult,
    SetFeesParams,
    SetFeesResult,
    SetStakingContractAddressParams,
    SwapParams,
    SwapResult,
} from './NativeSwapTypes.js';

export class NativeSwapTypesCoders {
    public static decodeGetLastPurgedBlockResult(response: CallResponse): bigint {
        if (!response.response) {
            throw new Error('No response to decode from getLastPurgedBlock');
        }

        const reader = new BinaryReader(response.response);
        return reader.readU64();
    }

    public static decodeBlocksWithReservationsLength(response: CallResponse): number {
        if (!response.response) {
            throw new Error('No response to decode from blocksWithReservationsLength');
        }

        const reader = new BinaryReader(response.response);
        return reader.readU32();
    }

    public static encodeGetLastPurgedBlockParams(
        selector: number,
        params: { token: Address },
    ): BinaryWriter {
        const calldata = new BinaryWriter();
        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeActivateProviderEvent(data: Uint8Array): IActivateProviderEvent {
        const reader = new BinaryReader(data);
        const providerId = reader.readU256();
        const listingAmount = reader.readU128();
        const btcToRemove = reader.readU64();

        return {
            name: 'ActivateProviderEvent',
            providerId,
            listingAmount,
            btcToRemove,
        };
    }

    public static decodeReservationPurgedEvent(data: Uint8Array): IReservationPurgedEvent {
        const reader = new BinaryReader(data);
        const reservationId = reader.readU128();
        const currentBlock = reader.readU64();
        const purgingBlock = reader.readU64();
        const purgeIndex = reader.readU32();
        const providerCount = reader.readU32();

        return {
            name: 'ReservationPurgedEvent',
            reservationId,
            currentBlock,
            purgingBlock,
            purgeIndex,
            providerCount,
        };
    }

    public static decodeFulfilledProviderEvent(data: Uint8Array): IFulfilledProviderEvent {
        const reader = new BinaryReader(data);
        const providerId = reader.readU256();
        const canceled = reader.readBoolean();
        const removalCompleted = reader.readBoolean();

        return {
            name: 'FulfilledProviderEvent',
            providerId,
            canceled,
            removalCompleted,
        };
    }

    public static decodeLiquidityAddedEvent(data: Uint8Array): ILiquidityAddedEvent {
        const reader = new BinaryReader(data);
        const totalTokensContributed = reader.readU256();
        const virtualTokenExchanged = reader.readU256();
        const totalSatoshisSpent = reader.readU64();
        return {
            name: 'LiquidityAddedEvent',
            totalTokensContributed,
            virtualTokenExchanged,
            totalSatoshisSpent,
        };
    }

    public static decodeLiquidityListedEvent(data: Uint8Array): ILiquidityListedEvent {
        const reader = new BinaryReader(data);
        const totalLiquidity = reader.readU128();
        const provider = reader.readStringWithLength();
        return { name: 'LiquidityListedEvent', totalLiquidity, provider };
    }

    public static decodeLiquidityRemovedEvent(data: Uint8Array): ILiquidityRemovedEvent {
        const reader = new BinaryReader(data);
        const providerId = reader.readU256();
        const satoshisOwed = reader.readU64();
        const tokenAmount = reader.readU256();

        return { name: 'LiquidityRemovedEvent', providerId, satoshisOwed, tokenAmount };
    }

    public static decodeLiquidityReservedEvent(data: Uint8Array): ILiquidityReservedEvent {
        const reader = new BinaryReader(data);
        const depositAddress = reader.readStringWithLength();
        const amount = reader.readU64();
        const providerId = reader.readU256();
        return { name: 'LiquidityReservedEvent', depositAddress, amount, providerId };
    }

    public static decodeCancelListingEvent(data: Uint8Array): IListingCanceledEvent {
        const reader = new BinaryReader(data);
        const amount = reader.readU128();
        return { name: 'ListingCanceledEvent', amount };
    }

    public static decodeReservationCreatedEvent(data: Uint8Array): IReservationCreatedEvent {
        const reader = new BinaryReader(data);
        const expectedAmountOut = reader.readU256();
        const totalSatoshis = reader.readU64();
        return { name: 'ReservationCreatedEvent', expectedAmountOut, totalSatoshis };
    }

    public static decodeSwapExecutedEvent(data: Uint8Array): ISwapExecutedEvent {
        const reader = new BinaryReader(data);
        const buyer = reader.readAddress();
        const amountIn = reader.readU64();
        const amountOut = reader.readU256();
        return { name: 'SwapExecutedEvent', buyer, amountIn, amountOut };
    }

    public static decodeReservationEvents(events: NetEvent[]): DecodedReservationEvents {
        const reservation: DecodedReservationEvents = {
            recipients: [],
            totalSatoshis: 0n,
        };

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            switch (event.type) {
                case 'LiquidityReserved': {
                    const recipient = this.decodeLiquidityReservedEvent(event.data);
                    reservation.totalSatoshis += recipient.amount;

                    reservation.recipients.push({
                        address: recipient.depositAddress,
                        amount: recipient.amount,
                        providerId: recipient.providerId.toString(),
                    });
                    break;
                }
                case 'ReservationCreated': {
                    reservation.reservation = this.decodeReservationCreatedEvent(event.data);
                    break;
                }
                case 'ReservationPurged': {
                    // Do nothing
                    break;
                }
                default: {
                    throw new Error(`Unknown event type: ${event.type}`);
                }
            }
        }

        return reservation;
    }

    public static decodeApprovedEvent(data: Uint8Array): IApprovedEvent {
        const reader = new BinaryReader(data);
        const owner = reader.readAddress();
        const spender = reader.readAddress();
        const value = reader.readU256();
        return { name: 'ApprovedEvent', owner, spender, value };
    }

    public static decodeTransferEvent(data: Uint8Array): ITransferEvent {
        const reader = new BinaryReader(data);
        const from = reader.readAddress();
        const to = reader.readAddress();
        const amount = reader.readU256();
        return { name: 'TransferEvent', from, to, amount };
    }

    public static encodeGetFeesParams(selector: number): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);

        return calldata;
    }

    public static decodeGetFeesResult(response: CallResponse): GetFeesResult {
        if (!response.response) {
            throw new Error('No response to decode from getFees');
        }

        const reader = new BinaryReader(response.response);
        return {
            reservationBaseFee: reader.readU64(),
            priorityQueueBaseFee: reader.readU64(),
            response: response,
        };
    }

    public static encodeGetStakingContractAddressParams(selector: number): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);

        return calldata;
    }

    public static decodeGetStakingContractAddressResult(
        response: CallResponse,
    ): GetStakingContractAddressResult {
        if (!response.response) {
            throw new Error('No response to decode from getStakingContractAddress');
        }

        const reader = new BinaryReader(response.response);
        return {
            stakingContractAddress: reader.readAddress(),
            response: response,
        };
    }

    public static encodeSetFeesParams(selector: number, params: SetFeesParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeU64(params.reservationBaseFee);
        calldata.writeU64(params.priorityQueueBaseFee);

        return calldata;
    }

    public static decodeSetFeesResult(response: CallResponse): SetFeesResult {
        if (!response.response) {
            throw new Error('No response to decode from setFees');
        }

        const reader = new BinaryReader(response.response);

        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeSetStakingContractAddressParams(
        selector: number,
        params: SetStakingContractAddressParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.stakingContractAddress);

        return calldata;
    }

    public static decodeSetContractAddressResult(response: CallResponse): SetFeesResult {
        if (!response.response) {
            throw new Error('No response to decode from setContractAddress');
        }

        const reader = new BinaryReader(response.response);

        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeGetAntibotSettingsParams(
        selector: number,
        params: GetAntibotSettingsParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeGetAntibotSettingsResult(response: CallResponse): GetAntibotSettingsResult {
        if (!response.response) {
            throw new Error('No response to decode from getAntibotSettings');
        }

        const reader = new BinaryReader(response.response);

        return {
            antiBotExpirationBlock: reader.readU64(),
            maxTokensPerReservation: reader.readU256(),
            response: response,
        };
    }

    public static encodeGetProviderDetailsParams(
        selector: number,
        params: GetProviderDetailsParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeGetProviderDetailsResult(response: CallResponse): GetProviderDetailsResult {
        if (!response.response) {
            throw new Error('No response to decode from getProviderDetails');
        }

        const reader = new BinaryReader(response.response);

        return {
            liquidity: reader.readU128(),
            reserved: reader.readU128(),
            liquidityProvided: reader.readU128(),
            btcReceiver: reader.readStringWithLength(),
            response: response,
            queueIndex: reader.readU32(),
            isPriority: reader.readBoolean(),
            purgeIndex: reader.readU32(),
            isActive: reader.readBoolean(),
        };
    }

    public static decodeGetQueueDetailsResult(response: CallResponse): GetQueueDetailsResult {
        if (!response.response) {
            throw new Error('No response to decode from getQueueDetails');
        }

        const reader = new BinaryReader(response.response);
        return {
            lastPurgedBlock: reader.readU32(),
            blockWithReservationsLength: reader.readU32(),

            removalQueueLength: reader.readU32(),
            removalQueueStartingIndex: reader.readU32(),

            priorityQueueLength: reader.readU32(),
            priorityQueueStartingIndex: reader.readU32(),

            standardQueueLength: reader.readU32(),
            standardQueueStartingIndex: reader.readU32(),

            priorityPurgeQueueLength: reader.readU32(),
            standardPurgeQueueLength: reader.readU32(),
            removePurgeQueueLength: reader.readU32(),
        };
    }

    public static encodeGetPriorityQueueCostParams(selector: number): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);

        return calldata;
    }

    public static decodeGetPriorityQueueCostResult(
        response: CallResponse,
    ): GetPriorityQueueCostResult {
        if (!response.response) {
            throw new Error('No response to decode from getPriorityQueueCost');
        }

        const reader = new BinaryReader(response.response);

        return {
            cost: reader.readU64(),
            response: response,
        };
    }

    public static encodeAddLiquidityParams(
        selector: number,
        params: AddLiquidityParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeStringWithLength(params.receiver);

        return calldata;
    }

    public static decodeAddLiquidityResult(response: CallResponse): AddLiquidityResult {
        if (!response.response) {
            throw new Error('No response to decode from addLiquidity');
        }

        const reader = new BinaryReader(response.response);
        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeRemoveLiquidityParams(
        selector: number,
        params: RemoveLiquidityParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeRemoveLiquidityResult(response: CallResponse): RemoveLiquidityResult {
        if (!response.response) {
            throw new Error('No response to decode from removeLiquidity');
        }

        const reader = new BinaryReader(response.response);
        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeCreatePoolParams(selector: number, params: CreatePoolParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeU256(params.floorPrice);
        calldata.writeU128(params.initialLiquidity);
        calldata.writeStringWithLength(params.receiver);
        calldata.writeU16(params.antiBotEnabledFor);
        calldata.writeU256(params.antiBotMaximumTokensPerReservation);
        calldata.writeU16(params.maxReservesIn5BlocksPercent);

        return calldata;
    }

    public static encodeCreatePoolWithSignatureParams(
        selector: number,
        params: CreatePoolWithSignatureParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeBytesWithLength(params.signature);
        calldata.writeU256(params.amount);
        calldata.writeU256(params.nonce);
        calldata.writeAddress(params.token);
        calldata.writeU256(params.floorPrice);
        calldata.writeU128(params.initialLiquidity);
        calldata.writeStringWithLength(params.receiver);
        calldata.writeU16(params.antiBotEnabledFor);
        calldata.writeU256(params.antiBotMaximumTokensPerReservation);
        calldata.writeU16(params.maxReservesIn5BlocksPercent);

        return calldata;
    }

    public static decodeCreatePoolResult(response: CallResponse): CreatePoolResult {
        if (!response.response) {
            throw new Error('No response to decode from createPool');
        }

        const reader = new BinaryReader(response.response);
        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static decodeCreatePoolWithSignatureResult(response: CallResponse): CreatePoolResult {
        if (!response.response) {
            throw new Error('No response to decode from createPoolWithSignature');
        }

        const reader = new BinaryReader(response.response);
        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeListLiquidityParams(
        selector: number,
        params: ListLiquidityParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeStringWithLength(params.receiver);
        calldata.writeU128(params.amountIn);
        calldata.writeBoolean(!!params.priority);

        return calldata;
    }

    public static decodeListLiquidityResult(response: CallResponse): ListLiquidityResult {
        if (!response.response) {
            throw new Error('No response to decode from listLiquidity');
        }

        const reader = new BinaryReader(response.response);
        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeReserveParams(selector: number, params: ReserveParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeU64(params.maximumAmountIn);
        calldata.writeU256(params.minimumAmountOut);
        calldata.writeBoolean(params.forLP);
        calldata.writeU8(params.activationDelay ?? 2);

        return calldata;
    }

    public static decodeReserveResult(response: CallResponse): ReserveResult {
        if (!response.response) {
            throw new Error('No response to decode from reserve');
        }

        const event = response.events[response.events.length - 1];
        if (!event) {
            throw new Error('No event to decode');
        }

        if (event.type !== 'ReservationCreated') {
            throw new Error('Wrong event returned');
        }

        const decodeEvent = this.decodeReservationCreatedEvent(event.data);

        return {
            expectedAmountOut: decodeEvent.expectedAmountOut,
            totalSatoshis: decodeEvent.totalSatoshis,
            response: response,
        };
    }

    public static encodeCancelListingParams(
        selector: number,
        params: CancelListingParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeCancelListingResult(response: CallResponse): CancelListingResult {
        if (!response.response) {
            throw new Error('No response to decode from cancel listing');
        }

        const reader = new BinaryReader(response.response);

        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeSwapParams(selector: number, params: SwapParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeSwapResult(response: CallResponse): SwapResult {
        if (!response.response) {
            throw new Error('No response to decode from swap');
        }

        const reader = new BinaryReader(response.response);

        return {
            result: reader.readBoolean(),
            response: response,
        };
    }

    public static encodeGetReserveParams(selector: number, params: GetReserveParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeGetReserveResult(response: CallResponse): GetReserveResult {
        if (!response.response) {
            throw new Error('No response to decode from getReserve');
        }

        const reader = new BinaryReader(response.response);

        return {
            liquidity: reader.readU256(),
            reservedLiquidity: reader.readU256(),
            virtualBTCReserve: reader.readU64(),
            virtualTokenReserve: reader.readU256(),
            response: response,
        };
    }

    public static encodeGetQuoteParams(selector: number, params: GetQuoteParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeU64(params.satoshisIn);

        return calldata;
    }

    public static decodeGetQuoteResult(response: CallResponse): GetQuoteResult {
        if (!response.response) {
            throw new Error('No response to decode from getQuote');
        }

        const reader = new BinaryReader(response.response);

        return {
            tokensOut: reader.readU256(),
            requiredSatoshis: reader.readU64(),
            price: reader.readU256(),
            scale: reader.readU64(),
            response: response,
        };
    }

    public static getLiquidityListedEvent(events: NetEvent[]): ILiquidityListedEvent | null {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            switch (event.type) {
                case 'LiquidityListed': {
                    const liquidityListed = this.decodeLiquidityListedEvent(event.data);
                    return liquidityListed;
                }
            }
        }

        return null;
    }

    public static getApprovedEvent(events: NetEvent[]): IApprovedEvent | null {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            switch (event.type) {
                case 'Approve': {
                    const approved = this.decodeApprovedEvent(event.data);
                    return approved;
                }
            }
        }

        return null;
    }
}
