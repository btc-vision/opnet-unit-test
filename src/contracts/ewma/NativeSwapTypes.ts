import { Address, BinaryReader, BinaryWriter, NetEvent } from '@btc-vision/transaction';
import { CallResponse } from '@btc-vision/unit-test-framework';

export interface LiquidityAddedEvent {
    readonly T: bigint;
    readonly B: bigint;
}

export interface LiquidityListedEvent {
    readonly totalLiquidity: bigint;
    readonly provider: string;
}

export interface LiquidityRemovedEvent {
    readonly token: Address;
    readonly amount: bigint;
    readonly remainingLiquidity: bigint;
}

export interface LiquidityReservedEvent {
    readonly depositAddress: string;
    readonly amount: bigint;
}

export interface ReservationCreatedEvent {
    readonly expectedAmountOut: bigint;
    readonly totalSatoshis: bigint;
}

export interface SwapExecutedEvent {
    readonly buyer: Address;
    readonly amountIn: bigint;
    readonly amountOut: bigint;
}

export interface SetFeesParams {
    readonly reservationBaseFee: bigint;
    readonly priorityQueueBaseFee: bigint;
    readonly pricePerUserInPriorityQueueBTC: bigint;
}

export interface SetFeesResult {
    readonly result: boolean;
    readonly response: CallResponse;
}

export interface GetFeesResult {
    readonly reservationBaseFee: bigint;
    readonly priorityQueueBaseFee: bigint;
    readonly pricePerUserInPriorityQueueBTC: bigint;
    readonly response: CallResponse;
}

export interface GetProviderDetailsParams {
    readonly token: Address;
}

export interface GetProviderDetailsResult {
    readonly liquidity: bigint;
    readonly reserved: bigint;
    readonly btcReceiver: string;
    readonly response: CallResponse;
}

export interface GetPriorityQueueCostParams {
    readonly token: Address;
}

export interface GetPriorityQueueCostResult {
    readonly cost: bigint;
    readonly response: CallResponse;
}

export interface AddLiquidityParams {
    readonly token: Address;
    readonly receiver: string;
}

export interface AddLiquidityResult {
    readonly result: boolean;
    readonly response: CallResponse;
}

export interface RemoveLiquidityParams {
    readonly token: Address;
}

export interface RemoveLiquidityResult {
    readonly result: boolean;
    readonly response: CallResponse;
}

export interface CreatePoolParams {
    readonly token: Address;
    readonly floorPrice: bigint;
    readonly initialLiquidity: bigint;
    readonly receiver: string;
    readonly antiBotEnabledFor: number;
    readonly antiBotMaximumTokensPerReservation: bigint;
    readonly maxReservesIn5BlocksPercent: number; //4000
}

export interface CreatePoolResult {
    readonly result: boolean;
    readonly response: CallResponse;
}

export interface ListLiquidityParams {
    readonly token: Address;
    readonly receiver: string;
    readonly amountIn: bigint;
    readonly priority: boolean; // = false lose 3% in fees
    readonly disablePriorityQueueFees: boolean; // not persisted
}

export interface ListLiquidityResult {
    readonly result: boolean;
    readonly response: CallResponse;
}

export interface ReserveParams {
    readonly token: Address;
    readonly maximumAmountIn: bigint;
    readonly minimumAmountOut: bigint;
    readonly forLP: boolean; // = false
}

export interface ReserveResult {
    readonly result: bigint;
    readonly response: CallResponse;
}

export interface CancelListingParams {
    readonly token: Address;
}

export interface CancelListingResult {
    readonly totalTokensReturned: bigint;
    readonly response: CallResponse;
}

export interface SwapParams {
    readonly token: Address;
    readonly isSimulation: boolean; // = false; not persisted
}

export interface SwapResult {
    readonly result: boolean;
    readonly response: CallResponse;
}

export interface GetReserveParams {
    readonly token: Address;
}

export interface GetReserveResult {
    readonly liquidity: bigint;
    readonly reservedLiquidity: bigint;
    readonly virtualBTCReserve: bigint;
    readonly virtualTokenReserve: bigint;
    readonly response: CallResponse;
}

export interface GetQuoteParams {
    readonly token: Address;
    readonly satoshisIn: bigint;
}

export interface GetQuoteResult {
    readonly tokensOut: bigint;
    readonly requiredSatoshis: bigint;
    readonly price: bigint;
    readonly response: CallResponse;
}

export interface GetVirtualReservesParams {
    readonly token: Address;
}

export interface GetVirtualReservesResult {
    readonly virtualBTCReserve: bigint;
    readonly virtualTokenReserve: bigint;
    readonly response: CallResponse;
}

export interface Recipient {
    readonly address: string;
    amount: bigint;
}

export interface DecodedReservation {
    readonly recipients: Recipient[];
    reservation?: ReservationCreatedEvent;
    totalSatoshis: bigint;
}

export class NativeSwapTypesDecoder {
    public static decodeLiquidityAddedEvent(data: Uint8Array): LiquidityAddedEvent {
        const reader = new BinaryReader(data);
        const T = reader.readU256();
        const B = reader.readU256();
        return { T, B };
    }

    public static decodeLiquidityListedEvent(data: Uint8Array): LiquidityListedEvent {
        const reader = new BinaryReader(data);
        const totalLiquidity = reader.readU128();
        const provider = reader.readStringWithLength();
        return { totalLiquidity, provider };
    }

    public static decodeLiquidityRemovedEvent(data: Uint8Array): LiquidityRemovedEvent {
        const reader = new BinaryReader(data);
        const token = reader.readAddress();
        const amount = reader.readU256();
        const remainingLiquidity = reader.readU256();

        return { token, amount, remainingLiquidity };
    }

    public static decodeLiquidityReservedEvent(data: Uint8Array): LiquidityReservedEvent {
        const reader = new BinaryReader(data);
        const depositAddress = reader.readStringWithLength();
        const amount = reader.readU128();
        return { depositAddress, amount };
    }

    public static decodeReservationCreatedEvent(data: Uint8Array): ReservationCreatedEvent {
        const reader = new BinaryReader(data);
        const expectedAmountOut = reader.readU256();
        const totalSatoshis = reader.readU256();
        return { expectedAmountOut, totalSatoshis };
    }

    public static decodeSwapExecutedEvent(data: Uint8Array): SwapExecutedEvent {
        const reader = new BinaryReader(data);
        const buyer = reader.readAddress();
        const amountIn = reader.readU256();
        const amountOut = reader.readU256();
        return { buyer, amountIn, amountOut };
    }

    public static decodeReservationEvents(events: NetEvent[]): DecodedReservation {
        const reservation: DecodedReservation = {
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
                    });
                    break;
                }
                case 'ReservationCreated': {
                    reservation.reservation = this.decodeReservationCreatedEvent(event.data);
                    break;
                }
                case 'Transfer': {
                    break;
                }
                default: {
                    throw new Error(`Unknown event type: ${event.type}`);
                }
            }
        }

        return reservation;
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
            pricePerUserInPriorityQueueBTC: reader.readU64(),
            response: response,
        };
    }

    public static encodeSetFeesParams(selector: number, params: SetFeesParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeU64(params.reservationBaseFee);
        calldata.writeU64(params.priorityQueueBaseFee);
        calldata.writeU64(params.pricePerUserInPriorityQueueBTC);

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
            btcReceiver: reader.readStringWithLength(),
            response: response,
        };
    }

    public static encodeGetPriorityQueueCostParams(
        selector: number,
        params: GetPriorityQueueCostParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

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

    public static encodeListLiquidityParams(
        selector: number,
        params: ListLiquidityParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeStringWithLength(params.receiver);
        calldata.writeU128(params.amountIn);
        calldata.writeBoolean(params.priority);

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
        calldata.writeU256(params.maximumAmountIn);
        calldata.writeU256(params.minimumAmountOut);
        calldata.writeBoolean(params.forLP);

        return calldata;
    }

    public static decodeReserveResult(response: CallResponse): ReserveResult {
        if (!response.response) {
            throw new Error('No response to decode from reserve');
        }

        const reader = new BinaryReader(response.response);

        return {
            result: reader.readU256(),
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
            totalTokensReturned: reader.readU128(),
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
            virtualBTCReserve: reader.readU256(),
            virtualTokenReserve: reader.readU256(),
            response: response,
        };
    }

    public static encodeGetQuoteParams(selector: number, params: GetQuoteParams): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);
        calldata.writeU256(params.satoshisIn);

        return calldata;
    }

    public static decodeGetQuoteResult(response: CallResponse): GetQuoteResult {
        if (!response.response) {
            throw new Error('No response to decode from getQuote');
        }

        const reader = new BinaryReader(response.response);

        return {
            tokensOut: reader.readU256(),
            requiredSatoshis: reader.readU256(),
            price: reader.readU256(),
            response: response,
        };
    }

    public static encodeGetVirtualReservesParams(
        selector: number,
        params: GetVirtualReservesParams,
    ): BinaryWriter {
        const calldata = new BinaryWriter();

        calldata.writeSelector(selector);
        calldata.writeAddress(params.token);

        return calldata;
    }

    public static decodeGetVirtualReservesResult(response: CallResponse): GetVirtualReservesResult {
        if (!response.response) {
            throw new Error('No response to decode from getVirtualReserves');
        }

        const reader = new BinaryReader(response.response);

        return {
            virtualBTCReserve: reader.readU256(),
            virtualTokenReserve: reader.readU256(),
            response: response,
        };
    }
}
