import { Address, BinaryWriter, NetEvent } from '@btc-vision/transaction';
import { BytecodeManager, ContractRuntime } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from '../../tests/utils/TransactionUtils.js';
import {
    AddLiquidityParams,
    AddLiquidityResult,
    CancelListingParams,
    CancelListingResult,
    CreatePoolParams,
    CreatePoolResult,
    GetFeesResult,
    GetPriorityQueueCostParams,
    GetPriorityQueueCostResult,
    GetProviderDetailsParams,
    GetProviderDetailsResult,
    GetQuoteParams,
    GetQuoteResult,
    GetReserveParams,
    GetReserveResult,
    GetVirtualReservesParams,
    GetVirtualReservesResult,
    ListLiquidityParams,
    ListLiquidityResult,
    NativeSwapTypesDecoder,
    RemoveLiquidityParams,
    RemoveLiquidityResult,
    ReserveParams,
    ReserveResult,
    SetFeesParams,
    SetFeesResult,
    SwapParams,
    SwapResult,
} from './NativeSwapTypes.js';

export class NativeSwap extends ContractRuntime {
    public static feeRecipient: string =
        'bcrt1plz0svv3wl05qrrv0dx8hvh5mgqc7jf3mhqgtw8jnj3l3d3cs6lzsfc3mxh';

    public static reservationFees: bigint = 10_000n; // The fixed fee rate per tick consumed.
    public static priorityQueueFees: bigint = 50_000n; // The fixed fee rate per tick consumed.

    // Define selectors for contract methods
    private readonly reserveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('reserve')}`,
    );

    private readonly swapSelector: number = Number(`0x${this.abiCoder.encodeSelector('swap')}`);

    private readonly listLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('listLiquidity')}`,
    );

    private readonly cancelListingSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('cancelListing')}`,
    );

    private readonly createPoolSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool')}`,
    );

    private readonly setFeesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setFees')}`,
    );

    private readonly addLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('addLiquidity')}`,
    );

    private readonly removeLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('removeLiquidity')}`,
    );

    private readonly getReserveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getReserve')}`,
    );

    private readonly getQuoteSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getQuote')}`,
    );

    private readonly getProviderDetailsSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getProviderDetails')}`,
    );

    private readonly getEWMASelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getEWMA')}`,
    );

    private readonly getPriorityQueueCostSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getPriorityQueueCost')}`,
    );

    private readonly getFeesSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getFees')}`,
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
        const calldata = NativeSwapTypesDecoder.encodeGetFeesParams(this.getFeesSelector);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeGetFeesResult(result);
    }

    public async setFees(params: SetFeesParams): Promise<SetFeesResult> {
        const calldata = NativeSwapTypesDecoder.encodeSetFeesParams(this.setFeesSelector, params);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeSetFeesResult(result);
    }

    public async getProviderDetails(
        params: GetProviderDetailsParams,
    ): Promise<GetProviderDetailsResult> {
        const calldata = NativeSwapTypesDecoder.encodeGetProviderDetailsParams(
            this.getProviderDetailsSelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeGetProviderDetailsResult(result);
    }

    public async getPriorityQueueCost(
        params: GetPriorityQueueCostParams,
    ): Promise<GetPriorityQueueCostResult> {
        const calldata = NativeSwapTypesDecoder.encodeGetPriorityQueueCostParams(
            this.getPriorityQueueCostSelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeGetPriorityQueueCostResult(result);
    }

    public async addLiquidity(params: AddLiquidityParams): Promise<AddLiquidityResult> {
        const calldata = NativeSwapTypesDecoder.encodeAddLiquidityParams(
            this.addLiquiditySelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeAddLiquidityResult(result);
    }

    public async removeLiquidity(params: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
        const calldata = NativeSwapTypesDecoder.encodeRemoveLiquidityParams(
            this.removeLiquiditySelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeRemoveLiquidityResult(result);
    }

    public async createPool(params: CreatePoolParams): Promise<CreatePoolResult> {
        const calldata = NativeSwapTypesDecoder.encodeCreatePoolParams(
            this.createPoolSelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeCreatePoolResult(result);
    }

    public async listLiquidity(params: ListLiquidityParams): Promise<ListLiquidityResult> {
        if (params.priority && !params.disablePriorityQueueFees) {
            createFeeOutput(NativeSwap.priorityQueueFees);
        }

        const calldata = NativeSwapTypesDecoder.encodeListLiquidityParams(
            this.listLiquiditySelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeListLiquidityResult(result);
    }

    public async reserve(params: ReserveParams): Promise<ReserveResult> {
        createFeeOutput(NativeSwap.reservationFees);

        const calldata = NativeSwapTypesDecoder.encodeReserveParams(this.reserveSelector, params);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeReserveResult(result);
    }

    public async cancelListing(params: CancelListingParams): Promise<CancelListingResult> {
        const calldata = NativeSwapTypesDecoder.encodeCancelListingParams(
            this.cancelListingSelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeCancelListingResult(result);
    }

    public async swap(params: SwapParams): Promise<SwapResult> {
        const calldata = NativeSwapTypesDecoder.encodeSwapParams(this.swapSelector, params);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeSwapResult(result);
    }

    public async getReserve(params: GetReserveParams): Promise<GetReserveResult> {
        const calldata = NativeSwapTypesDecoder.encodeGetReserveParams(
            this.getReserveSelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeGetReserveResult(result);
    }

    public async getQuote(params: GetQuoteParams): Promise<GetQuoteResult> {
        const calldata = NativeSwapTypesDecoder.encodeGetQuoteParams(this.getQuoteSelector, params);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeGetQuoteResult(result);
    }

    public async getVirtualReserves(
        params: GetVirtualReservesParams,
    ): Promise<GetVirtualReservesResult> {
        const calldata = NativeSwapTypesDecoder.encodeGetVirtualReservesParams(
            this.getEWMASelector,
            params,
        );

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        return NativeSwapTypesDecoder.decodeGetVirtualReservesResult(result);
    }

    /*public decodeReservationEvents(events: NetEvent[]): DecodedReservation {
        const e: DecodedReservation = {
            recipients: [],
            totalSatoshis: 0n,
        };

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            switch (event.type) {
                case 'LiquidityReserved': {
                    const recipient = NativeSwapEventsDecoder.decodeLiquidityReservedEvent(
                        event.data,
                    );
                    e.totalSatoshis += recipient.amount;

                    e.recipients.push(recipient);
                    break;
                }
                case 'ReservationCreated': {
                    e.reservation = NativeSwapEventsDecoder.decodeReservationCreatedEvent(
                        event.data,
                    );
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

        return e;
    }*/

    protected handleError(error: Error): Error {
        return new Error(`(in order book: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/nativeswap.wasm', this.address);
    }
}
