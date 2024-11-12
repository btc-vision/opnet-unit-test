import { ContractRuntime } from '../../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/transaction';
import { BytecodeManager } from '../../opnet/modules/GetBytecode.js';

// Define interfaces for events
export interface LiquidityAddedEvent {
    tickId: bigint;
    level: bigint;
    liquidityAmount: bigint;
    amountOut: bigint;
    receiver: string;
}

export interface ReservationCreatedEvent {
    reservationId: bigint;
    totalReserved: bigint;
    expectedAmountOut: bigint;
    buyer: Address;
}

export interface LiquidityRemovedEvent {
    token: Address;
    amount: bigint;
    tickId: bigint;
    level: bigint;
    liquidityAmount: bigint;
}

export interface LiquidityRemovalBlockedEvent {
    tickId: bigint;
    reservationsCount: bigint;
}

export interface SwapExecutedEvent {
    buyer: Address;
    amountIn: bigint;
    amountOut: bigint;
}

export interface TickUpdatedEvent {
    tickId: bigint;
    level: bigint;
    liquidityAmount: bigint;
    acquiredAmount: bigint;
}

export class OrderBook extends ContractRuntime {
    // Define selectors for contract methods
    private readonly getQuoteSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getQuote')}`,
    );
    private readonly reserveTicksSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('reserveTicks')}`,
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

    public constructor(deployer: Address, address: Address, gasLimit: bigint = 100_000_000_000n) {
        super({
            address: address,
            deployer: deployer,
            gasLimit,
        });
        this.preserveState();
    }

    // Event decoders
    public static decodeLiquidityAddedEvent(data: Uint8Array): LiquidityAddedEvent {
        const reader = new BinaryReader(data);
        const tickId = reader.readU256();
        const level = reader.readU256();
        const liquidityAmount = reader.readU256();
        const amountOut = reader.readU256();
        const receiver = reader.readStringWithLength();
        return { tickId, level, liquidityAmount, amountOut, receiver };
    }

    public static decodeReservationCreatedEvent(data: Uint8Array): ReservationCreatedEvent {
        const reader = new BinaryReader(data);
        const reservationId = reader.readU256();
        const totalReserved = reader.readU256();
        const expectedAmountOut = reader.readU256();
        const buyer = reader.readAddress();
        return { reservationId, totalReserved, expectedAmountOut, buyer };
    }

    public static decodeLiquidityRemovedEvent(data: Uint8Array): LiquidityRemovedEvent {
        const reader = new BinaryReader(data);
        const token = reader.readAddress();
        const amount = reader.readU256();
        const tickId = reader.readU256();
        const level = reader.readU256();
        const liquidityAmount = reader.readU256();
        return { token, amount, tickId, level, liquidityAmount };
    }

    public static decodeLiquidityRemovalBlockedEvent(
        data: Uint8Array,
    ): LiquidityRemovalBlockedEvent {
        const reader = new BinaryReader(data);
        const tickId = reader.readU256();
        const reservationsCount = reader.readU256();
        return { tickId, reservationsCount };
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
        const tickId = reader.readU256();
        const level = reader.readU256();
        const liquidityAmount = reader.readU256();
        const acquiredAmount = reader.readU256();
        return { tickId, level, liquidityAmount, acquiredAmount };
    }

    // Method to get a quote
    public async getQuote(token: Address, satoshisIn: bigint): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.getQuoteSelector);
        calldata.writeAddress(token);
        calldata.writeU256(satoshisIn);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getQuote');
        }

        const reader = new BinaryReader(response);
        return reader.readU256();
    }

    // Method to reserve ticks
    public async reserveTicks(
        token: Address,
        maximumAmountIn: bigint,
        minimumAmountOut: bigint,
        slippage: number,
    ): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.reserveTicksSelector);
        calldata.writeAddress(token);
        calldata.writeU256(maximumAmountIn);
        calldata.writeU256(minimumAmountOut);
        calldata.writeU16(slippage);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from reserveTicks');
        }

        const reader = new BinaryReader(response);
        return reader.readU256();
    }

    // Method to add liquidity
    public async addLiquidity(
        token: Address,
        receiver: Address,
        maximumAmountIn: bigint,
        maximumPriceLevel: bigint,
        slippage: number,
        invalidityPeriod: number,
    ): Promise<boolean> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.addLiquiditySelector);
        calldata.writeAddress(token);
        calldata.writeStringWithLength(receiver.toString()); // Assuming receiver is converted to string
        calldata.writeU256(maximumAmountIn);
        calldata.writeU256(maximumPriceLevel);
        calldata.writeU16(slippage);
        calldata.writeU16(invalidityPeriod);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from addLiquidity');
        }

        const reader = new BinaryReader(response);
        return reader.readBoolean();
    }

    // Method to remove liquidity
    public async removeLiquidity(token: Address, tickPositions: bigint[]): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.removeLiquiditySelector);
        calldata.writeAddress(token);
        calldata.writeTuple(tickPositions);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from removeLiquidity');
        }

        const reader = new BinaryReader(response);
        return reader.readU256();
    }

    // Method to execute a swap
    public async swap(
        token: Address,
        isSimulation: boolean,
        reservations: { reservationId: bigint; tickIds: bigint[] }[],
    ): Promise<boolean> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.swapSelector);
        calldata.writeAddress(token);
        calldata.writeBoolean(isSimulation);
        calldata.writeU16(reservations.length);

        for (const reservation of reservations) {
            calldata.writeU256(reservation.reservationId);
            calldata.writeTuple(reservation.tickIds);
        }

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from swap');
        }

        const reader = new BinaryReader(response);
        return reader.readBoolean();
    }

    // Method to get reserve
    public async getReserve(token: Address): Promise<bigint> {
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
        return reader.readU256();
    }

    protected handleError(error: Error): Error {
        return new Error(`(in order book: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/orderbook.wasm', this.address);
    }
}
