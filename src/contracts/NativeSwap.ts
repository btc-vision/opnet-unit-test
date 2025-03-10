import { Address } from '@btc-vision/transaction';
import { BytecodeManager, ContractRuntime } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from '../tests/utils/TransactionUtils.js';
import {
    AddLiquidityParams,
    AddLiquidityResult,
    CancelListingParams,
    CancelListingResult,
    CreatePoolParams,
    CreatePoolResult,
    CreatePoolWithSignatureParams,
    GetAntibotSettingsParams,
    GetAntibotSettingsResult,
    GetFeesResult,
    GetPriorityQueueCostResult,
    GetProviderDetailsParams,
    GetProviderDetailsResult,
    GetQuoteParams,
    GetQuoteResult,
    GetReserveParams,
    GetReserveResult,
    GetStakingContractAddressResult,
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
import { NativeSwapTypesCoders } from './NativeSwapTypesCoders.js';
import { Blockchain } from '../../../unit-test-framework/build/index.js';

export class NativeSwap extends ContractRuntime {
    public static feeRecipient: string =
        'bcrt1plz0svv3wl05qrrv0dx8hvh5mgqc7jf3mhqgtw8jnj3l3d3cs6lzsfc3mxh';

    public static reservationFees: bigint = 10_000n; // The fixed fee rate per tick consumed.
    public static priorityQueueFees: bigint = 50_000n; // The fixed fee rate per tick consumed.

    // Define selectors for contract methods
    private readonly reserveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('reserve(address,uint256,uint256,bool)')}`,
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
        `0x${this.abiCoder.encodeSelector('createPoolWithSignature(bytes,address,uint256,uint256,uint128,string,uint16,uint256,uint16)')}`,
    );

    private readonly setFeesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setFees(uint64,uint64)')}`,
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
        `0x${this.abiCoder.encodeSelector('getQuote(address,uint256)')}`,
    );

    private readonly getProviderDetailsSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getProviderDetails(address)')}`,
    );

    private readonly getPriorityQueueCostSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getPriorityQueueCost')}`,
    );

    private readonly getFeesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getFees')}`,
    );

    private readonly getAntibotSettingsSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getAntibotSettings(address)')}`,
    );

    private readonly setStakingContractAddressSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setStakingContractAddress(address)')}`,
    );
    private readonly getStakingContractAddressSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getStakingContractAddress')}`,
    );

    public constructor(deployer: Address, address: Address, gasLimit: bigint = 100_000_000_000n) {
        super({
            address: address,
            deployer: deployer,
            gasLimit,
        });

        this.preserveState();
    }

    public async getFees(): Promise<GetFeesResult> {
        const calldata = NativeSwapTypesCoders.encodeGetFeesParams(this.getFeesSelector);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesCoders.decodeGetFeesResult(result);
    }

    public async setFees(params: SetFeesParams): Promise<SetFeesResult> {
        const calldata = NativeSwapTypesCoders.encodeSetFeesParams(this.setFeesSelector, params);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeSetFeesResult(result);
    }

    public async getStakingContractAddress(): Promise<GetStakingContractAddressResult> {
        const calldata = NativeSwapTypesCoders.encodeGetStakingContractAddressParams(
            this.getStakingContractAddressSelector,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesCoders.decodeGetStakingContractAddressResult(result);
    }

    public async setStakingContractAddress(
        params: SetStakingContractAddressParams,
    ): Promise<SetFeesResult> {
        const calldata = NativeSwapTypesCoders.encodeSetStakingContractAddressParams(
            this.setStakingContractAddressSelector,
            params,
        );

        const result = await this.execute(calldata.getBuffer());
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

        const result = await this.execute(calldata.getBuffer());
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

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesCoders.decodeGetProviderDetailsResult(result);
    }

    public async getPriorityQueueCost(): Promise<GetPriorityQueueCostResult> {
        const calldata = NativeSwapTypesCoders.encodeGetPriorityQueueCostParams(
            this.getPriorityQueueCostSelector,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesCoders.decodeGetPriorityQueueCostResult(result);
    }

    public async addLiquidity(params: AddLiquidityParams): Promise<AddLiquidityResult> {
        const calldata = NativeSwapTypesCoders.encodeAddLiquidityParams(
            this.addLiquiditySelector,
            params,
        );

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeAddLiquidityResult(result);
    }

    public async removeLiquidity(params: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
        const calldata = NativeSwapTypesCoders.encodeRemoveLiquidityParams(
            this.removeLiquiditySelector,
            params,
        );

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeRemoveLiquidityResult(result);
    }

    public async createPool(params: CreatePoolParams): Promise<CreatePoolResult> {
        const calldata = NativeSwapTypesCoders.encodeCreatePoolParams(
            this.createPoolSelector,
            params,
        );

        const result = await this.execute(calldata.getBuffer());
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

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeCreatePoolWithSignatureResult(result);
    }

    public async listLiquidity(params: ListLiquidityParams): Promise<ListLiquidityResult> {
        if (params.priority && !params.disablePriorityQueueFees) {
            createFeeOutput(NativeSwap.priorityQueueFees);
        }

        const calldata = NativeSwapTypesCoders.encodeListLiquidityParams(
            this.listLiquiditySelector,
            params,
        );

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeListLiquidityResult(result);
    }

    public async reserve(params: ReserveParams): Promise<ReserveResult> {
        createFeeOutput(NativeSwap.reservationFees);

        const calldata = NativeSwapTypesCoders.encodeReserveParams(this.reserveSelector, params);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeReserveResult(result);
    }

    public async cancelListing(params: CancelListingParams): Promise<CancelListingResult> {
        const calldata = NativeSwapTypesCoders.encodeCancelListingParams(
            this.cancelListingSelector,
            params,
        );
        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeCancelListingResult(result);
    }

    public async swap(params: SwapParams): Promise<SwapResult> {
        const calldata = NativeSwapTypesCoders.encodeSwapParams(this.swapSelector, params);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        return NativeSwapTypesCoders.decodeSwapResult(result);
    }

    public async getReserve(params: GetReserveParams): Promise<GetReserveResult> {
        const calldata = NativeSwapTypesCoders.encodeGetReserveParams(
            this.getReserveSelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesCoders.decodeGetReserveResult(result);
    }

    public async getQuote(params: GetQuoteParams): Promise<GetQuoteResult> {
        const calldata = NativeSwapTypesCoders.encodeGetQuoteParams(this.getQuoteSelector, params);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesCoders.decodeGetQuoteResult(result);
    }

    protected handleError(error: Error): Error {
        return new Error(`(in order book: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/NativeSwap.wasm', this.address);
    }
}
