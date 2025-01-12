import { Address } from '@btc-vision/transaction';
import { CallResponse } from '@btc-vision/unit-test-framework';

export interface LiquidityAddedEvent {
    readonly totalTokensContributed: bigint;
    readonly virtualTokenExchanged: bigint;
    readonly totalSatoshisSpent: bigint;
}

export interface LiquidityListedEvent {
    readonly totalLiquidity: bigint;
    readonly provider: string;
}

export interface LiquidityRemovedEvent {
    readonly providerId: bigint;
    readonly btcOwed: bigint;
    readonly tokenAmount: bigint;
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

export interface GetAntibotSettingsParams {
    readonly token: Address;
}

export interface GetAntibotSettingsResult {
    readonly antiBotExpirationBlock: bigint;
    readonly maxTokensPerReservation: bigint;
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

export interface CreatePoolWithSignatureParams {
    readonly signature: Uint8Array;
    readonly amount: bigint;
    readonly address: Address;
    readonly token: Address;
    readonly floorPrice: bigint;
    readonly initialLiquidity: bigint;
    readonly receiver: string;
    readonly antiBotEnabledFor: number;
    readonly antiBotMaximumTokensPerReservation: bigint;
    readonly maxReservesIn5BlocksPercent: number; //4000
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
    readonly expectedAmountOut: bigint;
    readonly totalSatoshis: bigint;
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

export interface Recipient {
    readonly address: string;
    amount: bigint;
}

export interface DecodedReservationEvents {
    readonly recipients: Recipient[];
    reservation?: ReservationCreatedEvent;
    totalSatoshis: bigint;
}
