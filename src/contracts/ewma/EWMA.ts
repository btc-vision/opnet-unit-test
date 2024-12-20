import { Address, BinaryReader, BinaryWriter, NetEvent } from '@btc-vision/transaction';
import { BytecodeManager, CallResponse, ContractRuntime } from '@btc-vision/unit-test-framework';
import { createFeeOutput } from '../../tests/orderbook/utils/OrderBookUtils.js';

// Define interfaces for events
export interface LiquidityAddedEvent {
    readonly totalLiquidity: bigint;
    readonly receiver: string;
}

export interface ReservationCreatedEvent {
    readonly expectedAmountOut: bigint;
    readonly totalSatoshis: bigint;
}

export interface LiquidityRemovedEvent {
    readonly token: Address;
    readonly amount: bigint;
    readonly liquidityAmount: bigint;
}

export interface LiquidityRemovalBlockedEvent {
    readonly tickId: bigint;
}

export interface SwapExecutedEvent {
    readonly buyer: Address;
    readonly amountIn: bigint;
    readonly amountOut: bigint;
}

export interface TickUpdatedEvent {
    readonly liquidityAmount: bigint;
    readonly acquiredAmount: bigint;
}

export interface LiquidityReserved {
    readonly depositAddress: string;
    readonly amount: bigint;
}

export interface Reserve {
    readonly liquidity: bigint;
    readonly reserved: bigint;
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

export class EWMA extends ContractRuntime {
    // Random address
    public static feeRecipient: string =
        'bcrt1plz0svv3wl05qrrv0dx8hvh5mgqc7jf3mhqgtw8jnj3l3d3cs6lzsfc3mxh';

    public static readonly invalidAfter: bigint = 5n;

    public static fixedFeeRatePerTickConsumed: bigint = 10_000n; // The fixed fee rate per tick consumed.
    public static reservationFeePerProvider: bigint = 4_000n; // The fixed fee rate per tick consumed.
    public readonly minimumSatForTickReservation: bigint = 10_000n;
    public readonly minimumLiquidityForTickReservation: bigint = 1_000_000n;

    public readonly alpha: bigint = 10_000n;
    public readonly k: bigint = 10_000n;
    public readonly p0ScalingFactor: bigint = 10_000n;

    // Define selectors for contract methods
    private readonly getQuoteSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getQuote')}`,
    );
    private readonly reserveTicksSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('reserve')}`,
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
        `0x${this.abiCoder.encodeSelector('setQuote')}`,
    );

    private readonly verifySignatureSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('verifySignature')}`,
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

    // Event decoders
    public static decodeLiquidityAddedEvent(data: Uint8Array): LiquidityAddedEvent {
        const reader = new BinaryReader(data);
        const totalLiquidity = reader.readU128();
        const receiver = reader.readStringWithLength();
        return { totalLiquidity, receiver };
    }

    public static decodeReservationCreatedEvent(data: Uint8Array): ReservationCreatedEvent {
        const reader = new BinaryReader(data);
        const expectedAmountOut = reader.readU256();
        const totalSatoshis = reader.readU256();
        return { expectedAmountOut, totalSatoshis };
    }

    public static decodeLiquidityRemovedEvent(data: Uint8Array): LiquidityRemovedEvent {
        const reader = new BinaryReader(data);
        const token = reader.readAddress();
        const amount = reader.readU128();
        const liquidityAmount = reader.readU256();
        return { token, amount, liquidityAmount };
    }

    public static decodeLiquidityRemovalBlockedEvent(
        data: Uint8Array,
    ): LiquidityRemovalBlockedEvent {
        const reader = new BinaryReader(data);
        const tickId = reader.readU256();
        return { tickId };
    }

    public static decodeSwapExecutedEvent(data: Uint8Array): SwapExecutedEvent {
        const reader = new BinaryReader(data);
        const buyer = reader.readAddress();
        const amountIn = reader.readU256();
        const amountOut = reader.readU256();
        return { buyer, amountIn, amountOut };
    }

    public static decodeTickUpdatedEvent(data: Uint8Array): TickUpdatedEvent {
        const reader = new BinaryReader(data);
        const liquidityAmount = reader.readU256();
        const acquiredAmount = reader.readU256();
        return { liquidityAmount, acquiredAmount };
    }

    // Method to get a quote
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

    // Method to reserve ticks
    public async reserve(
        token: Address,
        maximumAmountIn: bigint,
        minimumAmountOut: bigint,
    ): Promise<{ result: bigint; response: CallResponse }> {
        createFeeOutput(EWMA.fixedFeeRatePerTickConsumed);

        const calldata = new BinaryWriter();
        calldata.writeSelector(this.reserveTicksSelector);
        calldata.writeAddress(token);
        calldata.writeU256(maximumAmountIn);
        calldata.writeU256(minimumAmountOut);

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

    // Method to add liquidity
    public async addLiquidity(
        token: Address,
        receiver: string,
        maximumAmountIn: bigint,
        priorityQueue: boolean = false, // lose 3% in fees
    ): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.addLiquiditySelector);
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
            throw new Error(`Failed to add liquidity`);
        }

        return result;
    }

    // Method to remove liquidity
    public async removeLiquidity(token: Address): Promise<{
        result: bigint;
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
                    const recipient = EWMA.decodeLiquidityReservedEvent(event.data);
                    e.totalSatoshis += recipient.amount;

                    e.recipients.push(recipient);
                    break;
                }
                case 'ReservationCreated': {
                    e.reservation = EWMA.decodeReservationCreatedEvent(event.data);
                    break;
                }
                default: {
                    throw new Error(`Unknown event type: ${event.type}`);
                }
            }
        }

        return e;
    }

    // Method to execute a swap
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
        };
    }

    public async setQuote(token: Address, p0: bigint): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.setQuoteSelector);
        calldata.writeAddress(token);
        calldata.writeU256(p0);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getReserve');
        }

        return result;
    }

    public async verifySignature(signature: Uint8Array, message: Uint8Array): Promise<boolean> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.verifySignatureSelector);
        calldata.writeBytesWithLength(signature);
        calldata.writeBytesWithLength(message);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getReserve');
        }

        return new BinaryReader(response).readBoolean();
    }

    protected handleError(error: Error): Error {
        return new Error(`(in order book: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/orderbook.wasm', this.address);
    }
}
