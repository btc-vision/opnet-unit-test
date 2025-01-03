import { Address, BinaryReader, BinaryWriter, NetEvent } from '@btc-vision/transaction';
import { BytecodeManager, CallResponse, ContractRuntime } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from '../../tests/utils/TransactionUtils.js';

export interface LiquidityListedEvent {
    readonly totalLiquidity: bigint;
    readonly receiver: string;
}

export interface LiquidityAddedEvent {
    readonly totalTokensContributed: bigint;
    readonly virtualTokenExchanged: bigint;
    readonly totalSatoshisSpent: bigint;
}

export interface ReservationCreatedEvent {
    readonly expectedAmountOut: bigint;
    readonly totalSatoshis: bigint;
}

export interface UnlistEvent {
    readonly token: Address;
    readonly amount: bigint;
    readonly liquidityAmount: bigint;
}

export interface SwapExecutedEvent {
    readonly buyer: Address;
    readonly amountIn: bigint;
    readonly amountOut: bigint;
}

export interface LiquidityReserved {
    readonly depositAddress: string;
    readonly amount: bigint;
}

export interface Reserve {
    readonly liquidity: bigint;
    readonly reserved: bigint;
    readonly virtualBTCReserve: bigint;
    readonly virtualTokenReserve: bigint;
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

export interface LiquidityRemovedEvent {
    readonly providerId: bigint;
    readonly btcOwed: bigint;
    readonly tokenAmount: bigint;
}

export class NativeSwap extends ContractRuntime {
    public static feeRecipient: string =
        'bcrt1plz0svv3wl05qrrv0dx8hvh5mgqc7jf3mhqgtw8jnj3l3d3cs6lzsfc3mxh';

    public static reservationFees: bigint = 10_000n; // The fixed fee rate per tick consumed.
    public static priorityQueueFees: bigint = 50_000n; // The fixed fee rate per tick consumed.

    // Define selectors for contract methods
    private readonly getQuoteSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getQuote')}`,
    );

    private readonly reserveTicksSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('reserve')}`,
    );

    private readonly listLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('listLiquidity')}`,
    );

    private readonly unlistLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('unlistLiquidity')}`,
    );

    private readonly addLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('addLiquidity')}`,
    );

    private readonly removeLiquiditySelector: number = Number(
        `0x${this.abiCoder.encodeSelector('removeLiquidity')}`,
    );

    private readonly swapSelector: number = Number(`0x${this.abiCoder.encodeSelector('swap')}`);
    private readonly getReserveSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getReserve')}`,
    );

    private readonly setQuoteSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('createPool')}`,
    );

    public constructor(deployer: Address, address: Address, gasLimit: bigint = 100_000_000_000n) {
        super({
            address: address,
            deployer: deployer,
            gasLimit,
        });

        this.preserveState();
    }

    public static decodeLiquidityReservedEvent(data: Uint8Array): Recipient {
        const reader = new BinaryReader(data);
        const depositAddress = reader.readStringWithLength();
        const amount = reader.readU128();
        return { address: depositAddress, amount };
    }

    public static decodeLiquidityListedEvent(data: Uint8Array): LiquidityListedEvent {
        const reader = new BinaryReader(data);
        const totalLiquidity = reader.readU128();
        const receiver = reader.readStringWithLength();
        return { totalLiquidity, receiver };
    }

    public static decodeLiquidityAddedEvent(data: Uint8Array): LiquidityAddedEvent {
        const reader = new BinaryReader(data);
        const totalTokensContributed = reader.readU256();
        const virtualTokenExchanged = reader.readU256();
        const totalSatoshisSpent = reader.readU256();
        return { totalTokensContributed, virtualTokenExchanged, totalSatoshisSpent };
    }

    public static decodeRemoveLiquidityEvent(data: Uint8Array): LiquidityRemovedEvent {
        const reader = new BinaryReader(data);
        const providerId = reader.readU256();
        const btcOwed = reader.readU256();
        const tokenAmount = reader.readU256();
        
        return { providerId, btcOwed, tokenAmount };
    }

    public static decodeReservationCreatedEvent(data: Uint8Array): ReservationCreatedEvent {
        const reader = new BinaryReader(data);
        const expectedAmountOut = reader.readU256();
        const totalSatoshis = reader.readU256();
        return { expectedAmountOut, totalSatoshis };
    }

    public static decodeUnlistEvent(data: Uint8Array): UnlistEvent {
        const reader = new BinaryReader(data);
        const token = reader.readAddress();
        const amount = reader.readU128();
        const liquidityAmount = reader.readU256();
        return { token, amount, liquidityAmount };
    }

    public static decodeSwapExecutedEvent(data: Uint8Array): SwapExecutedEvent {
        const reader = new BinaryReader(data);
        const buyer = reader.readAddress();
        const amountIn = reader.readU256();
        const amountOut = reader.readU256();
        return { buyer, amountIn, amountOut };
    }

    public async getQuote(
        token: Address,
        satoshisIn: bigint,
    ): Promise<{
        result: {
            expectedAmountOut: bigint;
            expectedAmountIn: bigint;
            currentPrice: bigint;
        };
        response: CallResponse;
    }> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.getQuoteSelector);
        calldata.writeAddress(token);
        calldata.writeU256(satoshisIn);

        this.backupStates();

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        this.restoreStates();

        const response = result.response;
        if (!response) {
            throw new Error('No response from getQuote');
        }

        const reader = new BinaryReader(response);
        return {
            result: {
                expectedAmountOut: reader.readU256(),
                expectedAmountIn: reader.readU256(),
                currentPrice: reader.readU256(),
            },
            response: result,
        };
    }

    public async reserve(
        token: Address,
        maximumAmountIn: bigint,
        minimumAmountOut: bigint,
        forLP: boolean = false,
    ): Promise<{ result: bigint; response: CallResponse }> {
        createFeeOutput(NativeSwap.reservationFees);

        const calldata = new BinaryWriter();
        calldata.writeSelector(this.reserveTicksSelector);
        calldata.writeAddress(token);
        calldata.writeU256(maximumAmountIn);
        calldata.writeU256(minimumAmountOut);
        calldata.writeBoolean(forLP);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from reserveTicks');
        }

        const reader = new BinaryReader(response);
        return {
            result: reader.readU256(),
            response: result,
        };
    }

    public async addLiquidity(token: Address, receiver: string): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.addLiquiditySelector);
        calldata.writeAddress(token);
        calldata.writeStringWithLength(receiver);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from addLiquidity');
        }

        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error(`Failed to add liquidity`);
        }

        return result;
    }

    public async removeLiquidity(token: Address): Promise<{
        result: boolean;
        response: CallResponse;
    }> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.removeLiquiditySelector);
        calldata.writeAddress(token);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from removeLiquidity');
        }

        const reader = new BinaryReader(response);
        return {
            result: reader.readBoolean(),
            response: result,
        };
    }

    public async listLiquidity(
        token: Address,
        receiver: string,
        maximumAmountIn: bigint,
        priorityQueue: boolean = false, // lose 3% in fees
        disablePriorityQueueFees: boolean = false,
    ): Promise<CallResponse> {
        if (priorityQueue && !disablePriorityQueueFees) {
            createFeeOutput(NativeSwap.priorityQueueFees);
        }

        const calldata = new BinaryWriter();
        calldata.writeSelector(this.listLiquiditySelector);
        calldata.writeAddress(token);
        calldata.writeStringWithLength(receiver); // Assuming receiver is converted to string
        calldata.writeU128(maximumAmountIn);
        calldata.writeBoolean(priorityQueue);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from addLiquidity');
        }

        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error(`Failed to list token`);
        }

        return result;
    }

    public async unlistLiquidity(token: Address): Promise<{
        result: bigint;
        response: CallResponse;
    }> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.unlistLiquiditySelector);
        calldata.writeAddress(token);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from removeLiquidity');
        }

        const reader = new BinaryReader(response);
        return {
            result: reader.readU256(),
            response: result,
        };
    }

    public decodeReservationEvents(events: NetEvent[]): DecodedReservation {
        const e: DecodedReservation = {
            recipients: [],
            totalSatoshis: 0n,
        };

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            switch (event.type) {
                case 'LiquidityReserved': {
                    const recipient = NativeSwap.decodeLiquidityReservedEvent(event.data);
                    e.totalSatoshis += recipient.amount;

                    e.recipients.push(recipient);
                    break;
                }
                case 'ReservationCreated': {
                    e.reservation = NativeSwap.decodeReservationCreatedEvent(event.data);
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
    }

    public async swap(
        token: Address,
        isSimulation: boolean = false,
    ): Promise<{ result: boolean; response: CallResponse }> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.swapSelector);
        calldata.writeAddress(token);
        calldata.writeBoolean(isSimulation);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from swap');
        }

        const reader = new BinaryReader(response);
        return {
            result: reader.readBoolean(),
            response: result,
        };
    }

    public async getReserve(token: Address): Promise<Reserve> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.getReserveSelector);
        calldata.writeAddress(token);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getReserve');
        }

        const reader = new BinaryReader(response);
        return {
            liquidity: reader.readU256(),
            reserved: reader.readU256(),
            virtualBTCReserve: reader.readU256(),
            virtualTokenReserve: reader.readU256(),
        };
    }

    public async createPool(
        token: Address,
        floorPrice: bigint,
        initialLiquidity: bigint,
        receiver: string,
        antiBotEnabledFor: number,
        antiBotMaximumTokensPerReservation: bigint,
        maxReservesIn5BlocksPercent: number = 4000,
    ): Promise<CallResponse> {
        if (maxReservesIn5BlocksPercent < 500 || maxReservesIn5BlocksPercent > 10000) {
            throw new Error('maxReservesIn5BlocksPercent should be between 500 and 10000');
        }

        const calldata = new BinaryWriter();
        calldata.writeSelector(this.setQuoteSelector);
        calldata.writeAddress(token);
        calldata.writeU256(floorPrice);
        calldata.writeU128(initialLiquidity);
        calldata.writeStringWithLength(receiver);
        calldata.writeU16(antiBotEnabledFor);
        calldata.writeU256(antiBotMaximumTokensPerReservation);
        calldata.writeU16(maxReservesIn5BlocksPercent);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getReserve');
        }

        return result;
    }

    protected handleError(error: Error): Error {
        return new Error(`(in order book: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/nativeswap.wasm', this.address);
    }
}
