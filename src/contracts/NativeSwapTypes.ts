import { Address } from '@btc-vision/transaction';
import { CallResponse } from '@btc-vision/unit-test-framework';
import { Network } from '@btc-vision/bitcoin';

export interface IActivateProviderEvent {
    readonly name: string;
    readonly providerId: bigint;
    readonly listingAmount: bigint;
    readonly btcToRemove: bigint;
}

export interface IProviderFulfilledEvent {
    readonly name: string;
    readonly providerId: bigint;
    readonly removalCompleted: boolean;
    readonly stakedAmount: bigint;
}

export interface IProviderConsumedEvent {
    readonly name: string;
    readonly providerId: bigint;
    readonly amountUsed: bigint;
}

export interface ILiquidityAddedEvent {
    readonly name: string;
    readonly totalTokensContributed: bigint;
    readonly virtualTokenExchanged: bigint;
    readonly totalSatoshisSpent: bigint;
}

export interface ILiquidityListedEvent {
    readonly name: string;
    readonly totalLiquidity: bigint;
    readonly provider: string;
}

export interface ILiquidityRemovedEvent {
    readonly name: string;
    readonly providerId: bigint;
    readonly satoshisOwed: bigint;
    readonly tokenAmount: bigint;
}

export interface ILiquidityReservedEvent {
    readonly name: string;
    readonly depositAddress: string;
    readonly satoshisAmount: bigint;
    readonly providerId: bigint;
    readonly tokenAmount: bigint;
}

export interface IReservationCreatedEvent {
    readonly name: string;
    readonly expectedAmountOut: bigint;
    readonly totalSatoshis: bigint;
}

export interface ISwapExecutedEvent {
    readonly name: string;
    readonly buyer: Address;
    readonly amountIn: bigint;
    readonly amountOut: bigint;
    readonly totalFees: bigint;
}

export interface IReservationFallbackEvent {
    readonly name: string;
    readonly reservationId: bigint;
    readonly expirationBlock: bigint;
}

export interface IApprovedEvent {
    readonly name: string;
    readonly owner: Address;
    readonly spender: Address;
    readonly value: bigint;
}

export interface ITransferEvent {
    readonly name: string;
    readonly operator: Address;
    readonly from: Address;
    readonly to: Address;
    readonly amount: bigint;
}

export interface IReservationPurgedEvent {
    readonly name: string;
    readonly reservationId: bigint;
    readonly currentBlock: bigint;
    readonly purgingBlock: bigint;
    readonly purgeIndex: number;
    readonly providerCount: number;
    readonly purgedAmount: bigint;
}

export interface IWithdrawListingEvent {
    readonly name: string;
    readonly amount: bigint;
    readonly tokenAddress: Address;
    readonly providerId: bigint;
    readonly providerAddress: Address;
}

export type AllEvent =
    | ILiquidityAddedEvent
    | ILiquidityListedEvent
    | ILiquidityRemovedEvent
    | ILiquidityReservedEvent
    | IReservationCreatedEvent
    | ISwapExecutedEvent
    | IApprovedEvent
    | ITransferEvent
    | IActivateProviderEvent
    | IProviderFulfilledEvent
    | IReservationPurgedEvent
    | IWithdrawListingEvent
    | IReservationFallbackEvent
    | IProviderConsumedEvent;

export interface SetFeesParams {
    readonly reservationBaseFee: bigint;
    readonly priorityQueueBaseFee: bigint;
}

export interface SetFeesResult {
    readonly response: CallResponse;
}

export interface GetFeesResult {
    readonly reservationBaseFee: bigint;
    readonly priorityQueueBaseFee: bigint;
    readonly response: CallResponse;
}

export interface SetFeesAddressParams {
    readonly feesAddress: string;
}

export interface SetFeesAddressResult {
    readonly response: CallResponse;
}

export interface GetFeesAddressResult {
    readonly feesAddress: string;
    readonly response: CallResponse;
}

export interface SetStakingContractAddressParams {
    readonly stakingContractAddress: Address;
}

export interface GetStakingContractAddressResult {
    readonly stakingContractAddress: Address;
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

export interface GetProviderDetailsByIdParams {
    readonly providerId: bigint;
}

export interface GetProviderDetailsResult {
    readonly id: bigint;
    readonly liquidity: bigint;
    readonly reserved: bigint;
    readonly btcReceiver: string;
    readonly response: CallResponse;
    readonly queueIndex: number;
    readonly isPriority: boolean;
    readonly purgeIndex: number;
    readonly isActive: boolean;
    readonly listedTokenAt: bigint;
    readonly isPurged: boolean;
    readonly canProvideLiquidity: boolean;
}

export interface GetQueueDetailsResult {
    readonly lastPurgedBlock: bigint;
    readonly blockWithReservationsLength: number;
    readonly priorityQueueLength: number;
    readonly priorityQueueStartingIndex: number;
    readonly standardQueueLength: number;
    readonly standardQueueStartingIndex: number;
    readonly priorityPurgeQueueLength: number;
    readonly standardPurgeQueueLength: number;
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
    readonly response: CallResponse;
}

export interface RemoveLiquidityParams {
    readonly token: Address;
}

export interface RemoveLiquidityResult {
    readonly response: CallResponse;
}

export enum PoolTypes {
    Standard = 0,
    Stable = 1,
}

export interface CreatePoolParams {
    readonly token: Address;
    readonly floorPrice: bigint;
    readonly initialLiquidity: bigint;
    readonly receiver: Address;
    readonly receiverStr?: string;
    readonly antiBotEnabledFor: number;
    readonly antiBotMaximumTokensPerReservation: bigint;
    readonly maxReservesIn5BlocksPercent: number; //4000
    readonly network: Network;
    readonly poolType?: PoolTypes;
    readonly amplification?: bigint;
    readonly pegStalenessThreshold?: bigint;
}

export interface CreatePoolResult {
    readonly response: CallResponse;
}

export interface CreatePoolWithSignatureParams extends CreatePoolParams {
    readonly signature: Uint8Array;
    readonly amount: bigint;
    readonly nonce: bigint;
    readonly network: Network;
}

export interface ListLiquidityParams {
    readonly token: Address;
    readonly receiver: Address;
    readonly amountIn: bigint;
    readonly priority?: boolean; // = false lose 3% in fees
    readonly disablePriorityQueueFees?: boolean; // not persisted
    readonly network: Network;
    readonly receiverStr?: string;
}

export interface ListLiquidityResult {
    readonly response: CallResponse;
}

export interface ReserveParams {
    readonly token: Address;
    readonly maximumAmountIn: bigint;
    readonly minimumAmountOut: bigint;
    readonly activationDelay?: number;
}

export interface ReserveResult {
    readonly expectedAmountOut: bigint;
    readonly totalSatoshis: bigint;
    readonly response: CallResponse;
}

export interface SwapParams {
    readonly token: Address;
}

export interface SwapResult {
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
    readonly scale: bigint;
    readonly response: CallResponse;
}

export interface Recipient {
    readonly address: string;
    amount: bigint;
    readonly providerId: string;
}

export interface DecodedReservationEvents {
    readonly recipients: Recipient[];
    reservation?: IReservationCreatedEvent;
    totalSatoshis: bigint;
}

export interface PauseResult {
    readonly response: CallResponse;
}

export interface UnpauseResult {
    readonly response: CallResponse;
}

export interface IsPausedResult {
    readonly isPaused: boolean;
    readonly response: CallResponse;
}

export interface ActivateWithdrawModeResult {
    readonly response: CallResponse;
}

export interface IsWithdrawModeActiveResult {
    readonly isWithdrawModeActive: boolean;
    readonly response: CallResponse;
}

export interface WithdrawListingParams {
    readonly token: Address;
}

export interface WithdrawListingResult {
    readonly response: CallResponse;
}
