import { Address } from '@btc-vision/transaction';
import { Blockchain, BytecodeManager, ContractRuntime } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from '../tests/utils/TransactionUtils.js';
import {
    ActivateWithdrawModeResult,
    AddLiquidityParams,
    AddLiquidityResult,
    CancelListingParams,
    CancelListingResult,
    CreatePoolParams,
    CreatePoolResult,
    CreatePoolWithSignatureParams,
    GetAntibotSettingsParams,
    GetAntibotSettingsResult,
    GetFeesAddressResult,
    GetFeesResult,
    GetPriorityQueueCostResult,
    GetProviderDetailsByIdParams,
    GetProviderDetailsParams,
    GetProviderDetailsResult,
    GetQueueDetailsResult,
    GetQuoteParams,
    GetQuoteResult,
    GetReserveParams,
    GetReserveResult,
    GetStakingContractAddressResult,
    IsPausedResult,
    IsWithdrawModeActiveResult,
    ListLiquidityParams,
    ListLiquidityResult,
    PauseResult,
    RemoveLiquidityParams,
    RemoveLiquidityResult,
    ReserveParams,
    ReserveResult,
    SetFeesAddressParams,
    SetFeesAddressResult,
    SetFeesParams,
    SetFeesResult,
    SetStakingContractAddressParams,
    SwapParams,
    SwapResult,
    UnpauseResult,
    WithdrawListingParams,
    WithdrawListingResult,
} from './NativeSwapTypes.js';
import { NativeSwapTypesCoders } from './NativeSwapTypesCoders.js';
import { GetFees } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

export class NativeSwap extends ContractRuntime {
    public static RESERVATION_EXPIRE_AFTER: number = 5;
    public static PURGE_AT_LEAST_X_PROVIDERS: number = 150;

    public static feeRecipient: string =
        'bcrt1plz0svv3wl05qrrv0dx8hvh5mgqc7jf3mhqgtw8jnj3l3d3cs6lzsfc3mxh';

    public static feeRecipientTestnet: string =
        'tb1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0q3cyz4c';

    public static reservationFees: bigint = 10_000n; // The fixed fee rate per tick consumed.
    public static priorityQueueFees: bigint = 50_000n; // The fixed fee rate per tick consumed.

    // Define selectors for contract methods
    private readonly reserveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('reserve(address,uint64,uint256,bool,uint8)')}`,
    );

    private readonly swapSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('swap(address)')}`,
    );

    private readonly listLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('listLiquidity(address,string,uint128,bool)')}`,
    );

    private readonly cancelListingSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('cancelListing(address)')}`,
    );

    private readonly createPoolSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool(address,uint256,uint128,string,uint16,uint256,uint16)')}`,
    );

    private readonly createPoolWithSignatureSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPoolWithSignature(bytes,uint256,uint256,address,uint256,uint128,string,uint16,uint256,uint16)')}`,
    );

    private readonly setFeesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setFees(uint64,uint64)')}`,
    );

    private readonly setFeesAddressSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setFeesAddress(string)')}`,
    );

    private readonly addLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('addLiquidity(address,string)')}`,
    );

    private readonly removeLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('removeLiquidity(address)')}`,
    );

    private readonly getReserveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getReserve(address)')}`,
    );

    private readonly getQuoteSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getQuote(address,uint64)')}`,
    );

    private readonly getProviderDetailsSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getProviderDetails(address)')}`,
    );

    private readonly getProviderDetailsByIdSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getProviderDetailsById(u256)')}`,
    );

    private readonly getQueueDetailsSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getQueueDetails(address)')}`,
    );

    private readonly getPriorityQueueCostSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getPriorityQueueCost()')}`,
    );

    private readonly getFeesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getFees()')}`,
    );

    private readonly getFeesAddressSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getFeesAddress()')}`,
    );

    private readonly getAntibotSettingsSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getAntibotSettings(address)')}`,
    );

    private readonly setStakingContractAddressSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setStakingContractAddress(address)')}`,
    );
    private readonly getStakingContractAddressSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getStakingContractAddress()')}`,
    );

    private readonly getLastPurgedBlockSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getLastPurgedBlock(address)')}`,
    );

    private readonly getBlocksWithReservationsLengthSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getBlocksWithReservationsLength(address)')}`,
    );

    private readonly purgeReservationsAndRestoreProvidersSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('purgeReservationsAndRestoreProviders(address)')}`,
    );

    private readonly pauseSelector: number = Number(`0x${this.abiCoder.encodeSelector('pause()')}`);

    private readonly unpauseSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('unpause()')}`,
    );

    private readonly isPausedSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('isPaused()')}`,
    );

    private readonly activateWithdrawModeSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('activateWithdrawMode()')}`,
    );

    private readonly isWithdrawModeActiveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('isWithdrawModeActive()')}`,
    );

    private readonly withdrawListingSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('withdrawListing(address)')}`,
    );

    public constructor(
        deployer: Address,
        address: Address,
        gasLimit: bigint = 2_500_000_000_000n, //1_000_000_000_000_000n,
    ) {
        super({
            address: address,
            deployer: deployer,
            gasLimit,
        });
    }

    public async pause(): Promise<PauseResult> {
        const calldata = NativeSwapTypesCoders.encodeDefault(this.pauseSelector);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodePauseResult(result);
    }

    public async unpause(): Promise<UnpauseResult> {
        const calldata = NativeSwapTypesCoders.encodeDefault(this.unpauseSelector);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeUnpauseResult(result);
    }

    public async isPaused(): Promise<IsPausedResult> {
        const calldata = NativeSwapTypesCoders.encodeDefault(this.isPausedSelector);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeIsPausedResult(result);
    }

    public async activateWithdrawMode(): Promise<ActivateWithdrawModeResult> {
        const calldata = NativeSwapTypesCoders.encodeDefault(this.activateWithdrawModeSelector);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeActivateWithdrawModeResult(result);
    }

    public async isWithdrawModeActive(): Promise<IsWithdrawModeActiveResult> {
        const calldata = NativeSwapTypesCoders.encodeDefault(this.isWithdrawModeActiveSelector);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeIsWithdrawModeActiveResult(result);
    }

    public async withdrawListing(params: WithdrawListingParams): Promise<WithdrawListingResult> {
        const calldata = NativeSwapTypesCoders.encodeWithdrawListingParams(
            this.withdrawListingSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeWithdrawListingResult(result);
    }

    public async getLastPurgedBlock(params: Address): Promise<bigint> {
        const calldata = NativeSwapTypesCoders.encodeGetLastPurgedBlockParams(
            this.getLastPurgedBlockSelector,
            {
                token: params,
            },
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetLastPurgedBlockResult(result);
    }

    public async purgeReservationsAndRestoreProviders(token: Address): Promise<void> {
        const calldata = NativeSwapTypesCoders.encodeGetLastPurgedBlockParams(
            this.purgeReservationsAndRestoreProvidersSelector,
            {
                token: token,
            },
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);
    }

    public async getBlocksWithReservationsLength(params: Address): Promise<number> {
        const calldata = NativeSwapTypesCoders.encodeGetLastPurgedBlockParams(
            this.getBlocksWithReservationsLengthSelector,
            {
                token: params,
            },
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeBlocksWithReservationsLength(result);
    }

    public async getFees(): Promise<GetFeesResult> {
        const calldata = NativeSwapTypesCoders.encodeGetFeesParams(this.getFeesSelector);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetFeesResult(result);
    }

    public async setFees(params: SetFeesParams): Promise<SetFeesResult> {
        const calldata = NativeSwapTypesCoders.encodeSetFeesParams(this.setFeesSelector, params);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeSetFeesResult(result);
    }

    public async getFeesAddress(): Promise<GetFeesAddressResult> {
        const calldata = NativeSwapTypesCoders.encodeGetFeesAddressParams(
            this.getFeesAddressSelector,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetFeesAddressResult(result);
    }

    public async setFeesAddress(params: SetFeesAddressParams): Promise<SetFeesAddressResult> {
        const calldata = NativeSwapTypesCoders.encodeSetFeesAddressParams(
            this.setFeesAddressSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeSetFeesAddressResult(result);
    }

    public async getStakingContractAddress(): Promise<GetStakingContractAddressResult> {
        const calldata = NativeSwapTypesCoders.encodeGetStakingContractAddressParams(
            this.getStakingContractAddressSelector,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetStakingContractAddressResult(result);
    }

    public async setStakingContractAddress(
        params: SetStakingContractAddressParams,
    ): Promise<SetFeesResult> {
        const calldata = NativeSwapTypesCoders.encodeSetStakingContractAddressParams(
            this.setStakingContractAddressSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeSetContractAddressResult(result);
    }

    public async getAntibotSettings(
        params: GetAntibotSettingsParams,
    ): Promise<GetAntibotSettingsResult> {
        const calldata = NativeSwapTypesCoders.encodeGetAntibotSettingsParams(
            this.getAntibotSettingsSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetAntibotSettingsResult(result);
    }

    public async getProviderDetails(
        params: GetProviderDetailsParams,
    ): Promise<GetProviderDetailsResult> {
        const calldata = NativeSwapTypesCoders.encodeGetProviderDetailsParams(
            this.getProviderDetailsSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetProviderDetailsResult(result);
    }

    public async getProviderDetailsById(
        params: GetProviderDetailsByIdParams,
    ): Promise<GetProviderDetailsResult> {
        const calldata = NativeSwapTypesCoders.encodeGetProviderDetailsByIdParams(
            this.getProviderDetailsSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetProviderDetailsResult(result);
    }

    public async getQueueDetails(params: GetProviderDetailsParams): Promise<GetQueueDetailsResult> {
        const calldata = NativeSwapTypesCoders.encodeGetProviderDetailsParams(
            this.getQueueDetailsSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetQueueDetailsResult(result);
    }

    public async getPriorityQueueCost(): Promise<GetPriorityQueueCostResult> {
        const calldata = NativeSwapTypesCoders.encodeGetPriorityQueueCostParams(
            this.getPriorityQueueCostSelector,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetPriorityQueueCostResult(result);
    }

    public async addLiquidity(params: AddLiquidityParams): Promise<AddLiquidityResult> {
        const calldata = NativeSwapTypesCoders.encodeAddLiquidityParams(
            this.addLiquiditySelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeAddLiquidityResult(result);
    }

    public async removeLiquidity(params: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
        const calldata = NativeSwapTypesCoders.encodeRemoveLiquidityParams(
            this.removeLiquiditySelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeRemoveLiquidityResult(result);
    }

    public async createPool(params: CreatePoolParams): Promise<CreatePoolResult> {
        const calldata = NativeSwapTypesCoders.encodeCreatePoolParams(
            this.createPoolSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeCreatePoolResult(result);
    }

    public async createPoolWithSignature(
        params: CreatePoolWithSignatureParams,
    ): Promise<CreatePoolResult> {
        const calldata = NativeSwapTypesCoders.encodeCreatePoolWithSignatureParams(
            this.createPoolWithSignatureSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeCreatePoolWithSignatureResult(result);
    }

    public async listLiquidity(
        params: ListLiquidityParams,
        feesAddress: string = '',
    ): Promise<ListLiquidityResult> {
        if (params.priority && !params.disablePriorityQueueFees) {
            let recipient: string = feesAddress;

            if (feesAddress.length === 0) {
                if (Blockchain.network.bech32 === networks.testnet.bech32) {
                    recipient = NativeSwap.feeRecipientTestnet;
                } else {
                    recipient = NativeSwap.feeRecipient;
                }
            }

            createFeeOutput(NativeSwap.priorityQueueFees, recipient);
        }

        const calldata = NativeSwapTypesCoders.encodeListLiquidityParams(
            this.listLiquiditySelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeListLiquidityResult(result);
    }

    public async reserve(params: ReserveParams, feesAddress: string = ''): Promise<ReserveResult> {
        let recipient: string = feesAddress;

        if (feesAddress.length === 0) {
            if (Blockchain.network.bech32 === networks.testnet.bech32) {
                recipient = NativeSwap.feeRecipientTestnet;
            } else {
                recipient = NativeSwap.feeRecipient;
            }
        }

        createFeeOutput(NativeSwap.reservationFees, recipient);

        const calldata = NativeSwapTypesCoders.encodeReserveParams(this.reserveSelector, params);
        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeReserveResult(result);
    }

    public async cancelListing(params: CancelListingParams): Promise<CancelListingResult> {
        const calldata = NativeSwapTypesCoders.encodeCancelListingParams(
            this.cancelListingSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeCancelListingResult(result);
    }

    public async swap(params: SwapParams): Promise<SwapResult> {
        const calldata = NativeSwapTypesCoders.encodeSwapParams(this.swapSelector, params);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeSwapResult(result);
    }

    public async getReserve(params: GetReserveParams): Promise<GetReserveResult> {
        const calldata = NativeSwapTypesCoders.encodeGetReserveParams(
            this.getReserveSelector,
            params,
        );

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetReserveResult(result);
    }

    public async getQuote(params: GetQuoteParams): Promise<GetQuoteResult> {
        const calldata = NativeSwapTypesCoders.encodeGetQuoteParams(this.getQuoteSelector, params);

        const result = await this.execute({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });

        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeGetQuoteResult(result);
    }

    protected handleError(error: Error): Error {
        return new Error(`(in nativeswap: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/NativeSwap.wasm', this.address);
    }
}
