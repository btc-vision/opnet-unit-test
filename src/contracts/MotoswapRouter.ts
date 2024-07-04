import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { BinaryWriter } from '@btc-vision/bsi-binary';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
import { AddLiquidityParameters } from '../interfaces/RouterInterfaces.js';

export class MotoswapRouter extends ContractRuntime {
    private readonly ADD_LIQUIDITY_SELECTOR: number = Number(
        `0x${this.abiCoder.encodeSelector('addLiquidity')}`,
    );

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
}
