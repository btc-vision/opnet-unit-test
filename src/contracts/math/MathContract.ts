import { BinaryWriter } from '@btc-vision/transaction';
import { CallResponse, OP20, OP20Interface } from '@btc-vision/unit-test-framework';

export class MathContract extends OP20 {
    public readonly file: string;
    public readonly decimals: number;

    protected readonly safeTransferFromSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('testSimpleStringConversion()')}`,
    );

    constructor(details: OP20Interface) {
        super(details);

        this.file = details.file;
        this.decimals = details.decimals;
    }

    public async testSimpleStringConversion(): Promise<CallResponse> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.safeTransferFromSelector);

        const buf = calldata.getBuffer();
        return await this.executeThrowOnError({
            calldata: buf,
        });
    }
}
