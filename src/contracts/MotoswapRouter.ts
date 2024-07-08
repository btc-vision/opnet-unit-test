import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { AddLiquidityParameters } from '../interfaces/RouterInterfaces.js';

export class MotoswapRouter extends ContractRuntime {
    private readonly ADD_LIQUIDITY_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('addLiquidity')}`,
    );

    private readonly QUOTE_SELECTOR: number = Number(`0x${this.abiCoder.encodeSelector('quote')}`);
    private readonly GET_AMOUNT_OUT_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('getAmountOut')}`,
    );
    private readonly GET_AMOUNT_IN_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('getAmountIn')}`,
    );
    private readonly GET_AMOUNTS_OUT_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('getAmountsOut')}`,
    );
    private readonly GET_AMOUNTS_IN_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('getAmountsIn')}`,
    );

    private readonly swapExactTokensForTokensSupportingFeeOnTransferTokensSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('swapExactTokensForTokensSupportingFeeOnTransferTokens')}`,
    );

    private readonly FACTORY_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('factory')}`,
    );

    private readonly WBTC_SELECTOR: number = Number(`0x${this.abiCoder.encodeSelector('WBTC')}`);

    constructor(gasLimit: bigint = 300_000_000_000n) {
        super(
            'bcrt1q6tttv4cdg8eczf0cnk0fz4a65dc5yre92qa721',
            'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
            gasLimit,
        );

        this.preserveState();
    }

    protected handleError(error: Error): Error {
        return new Error(`(in router: ${this.address}) OPNET: ${error.stack}`);
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode('./bytecode/router.wasm', this.address);
    }

    public async getFactory(): Promise<Address> {
        const result = await this.readView(this.FACTORY_SELECTOR);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readAddress();
    }

    public async getWBTC(): Promise<Address> {
        const result = await this.readView(this.WBTC_SELECTOR);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readAddress();
    }

    public async quote(amountA: bigint, reserveA: bigint, reserveB: bigint): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountA);
        calldata.writeU256(reserveA);
        calldata.writeU256(reserveB);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.QUOTE_SELECTOR, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readU256();
    }

    public async getAmountOut(
        amountIn: bigint,
        reserveIn: bigint,
        reserveOut: bigint,
    ): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountIn);
        calldata.writeU256(reserveIn);
        calldata.writeU256(reserveOut);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNT_OUT_SELECTOR, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readU256();
    }

    public async getAmountIn(
        amountOut: bigint,
        reserveIn: bigint,
        reserveOut: bigint,
    ): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountOut);
        calldata.writeU256(reserveIn);
        calldata.writeU256(reserveOut);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNT_IN_SELECTOR, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readU256();
    }

    public async getAmountsOut(amountIn: bigint, path: Address[]): Promise<bigint[]> {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountIn);
        calldata.writeAddressArray(path);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNTS_OUT_SELECTOR, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readTuple();
    }

    public async getAmountsIn(amountOut: bigint, path: Address[]): Promise<bigint[]> {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountOut);
        calldata.writeAddressArray(path);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.GET_AMOUNTS_IN_SELECTOR, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        const reader = new BinaryReader(response);
        return reader.readTuple();
    }

    public async addLiquidity(parameters: AddLiquidityParameters): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(parameters.tokenA);
        calldata.writeAddress(parameters.tokenB);

        calldata.writeU256(parameters.amountADesired);
        calldata.writeU256(parameters.amountBDesired);

        calldata.writeU256(parameters.amountAMin);
        calldata.writeU256(parameters.amountBMin);

        calldata.writeAddress(parameters.to);
        calldata.writeU64(parameters.deadline);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(this.ADD_LIQUIDITY_SELECTOR, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        return result;
    }

    public async swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn: bigint,
        amountOutMin: bigint,
        path: Address[],
        to: Address,
        deadline: bigint,
    ): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeU256(amountIn);
        calldata.writeU256(amountOutMin);
        calldata.writeAddressArray(path);
        calldata.writeAddress(to);
        calldata.writeU64(deadline);

        const buf = calldata.getBuffer();
        const result = await this.readMethod(
            this.swapExactTokensForTokensSupportingFeeOnTransferTokensSelector,
            Buffer.from(buf),
        );

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        this.dispose();

        return result;
    }
}
