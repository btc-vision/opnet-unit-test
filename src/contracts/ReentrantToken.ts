import { BinaryReader, BinaryWriter } from '@btc-vision/transaction';
import { OP_20 } from '@btc-vision/unit-test-framework';

export class ReentrantToken extends OP_20 {
    protected readonly setCallbackSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('setCallback(string)')}`,
    );

    public async setCallback(method: string): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.setCallbackSelector);
        calldata.writeStringWithLength(method);

        const buf = calldata.getBuffer();
        const result = await this.execute({
            calldata: buf,
            txOrigin: this.deployer,
            sender: this.deployer,
        });

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }

        const reader = new BinaryReader(response);
        if (!reader.readBoolean()) {
            throw new Error('setCallback failed');
        }
    }
}
