import { Address, BinaryReader, BinaryWriter } from '@btc-vision/transaction';
import { BytecodeManager, CallResponse, ContractRuntime } from '@btc-vision/unit-test-framework';

// Define interfaces for events
export interface LiquidityAddedEvent {
    readonly tickId: bigint;
    readonly level: bigint;
    readonly liquidityAmount: bigint;
    readonly amountOut: bigint;
    readonly receiver: string;
}

export interface ReservationCreatedEvent {
    readonly reservationId: bigint;
    readonly totalReserved: bigint;
    readonly expectedAmountOut: bigint;
    readonly buyer: Address;
}

export interface LiquidityRemovedEvent {
    readonly token: Address;
    readonly amount: bigint;
    readonly tickId: bigint;
    readonly level: bigint;
    readonly liquidityAmount: bigint;
}

export interface LiquidityRemovalBlockedEvent {
    readonly tickId: bigint;
    readonly reservationsCount: bigint;
}

export interface SwapExecutedEvent {
    readonly buyer: Address;
    readonly amountIn: bigint;
    readonly amountOut: bigint;
}

export interface TickUpdatedEvent {
    readonly tickId: bigint;
    readonly level: bigint;
    readonly liquidityAmount: bigint;
    readonly acquiredAmount: bigint;
}

export interface TickReserve {
    readonly totalLiquidity: bigint;
    readonly totalReserved: bigint;
    readonly availableLiquidity: bigint;
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

    private readonly getReserveTickSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('getReserveForTick')}`,
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
    public async getQuote(
        token: Address,
        satoshisIn: bigint,
        minimumLiquidityPerTick: bigint, // gas optimization
    ): Promise<{
        result: bigint;
        response: CallResponse;
    }> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.getQuoteSelector);
        calldata.writeAddress(token);
        calldata.writeU256(satoshisIn);
        calldata.writeU256(minimumLiquidityPerTick);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getQuote');
        }

        const reader = new BinaryReader(response);
        return {
            result: reader.readU256(),
            response: result,
        };
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
        receiver: string,
        maximumAmountIn: bigint,
        maximumPriceLevel: bigint,
        slippage: number,
        invalidityPeriod: number,
    ): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.addLiquiditySelector);
        calldata.writeAddress(token);
        calldata.writeStringWithLength(receiver); // Assuming receiver is converted to string
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
        if (!reader.readBoolean()) {
            throw new Error(`Failed to add liquidity`);
        }

        return result;
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

    public async getReserveForTick(token: Address, level: bigint): Promise<TickReserve> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.getReserveTickSelector);
        calldata.writeAddress(token);
        calldata.writeU256(level);

        const result = await this.execute(calldata.getBuffer());
        if (result.error) throw this.handleError(result.error);

        const response = result.response;
        if (!response) {
            throw new Error('No response from getReserve');
        }

        const reader = new BinaryReader(response);

        const totalLiquidity = reader.readU256();
        const totalReserved = reader.readU256();
        const availableLiquidity = reader.readU256();

        return { totalLiquidity, totalReserved, availableLiquidity };
    }

    protected handleError(error: Error): Error {
        return new Error(`(in order book: ${this.address}) OPNET: ${error.message}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/orderbook.wasm', this.address);
    }
}
