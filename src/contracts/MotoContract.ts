import { Address, AddressMap, BinaryWriter } from '@btc-vision/transaction';
import { OP20, OP20Interface } from '@btc-vision/unit-test-framework';

export class MotoContract extends OP20 {
    public readonly file: string;
    public readonly decimals: number;

    protected readonly safeTransferFromSelector: number = Number(
        `0x${this.abiCoder.encodeSelector('testSimpleStringConversion()')}`,
    );

    constructor(details: OP20Interface) {
        const calldata = new BinaryWriter();
        calldata.writeAddress(details.deployer);

        super({ ...details, deploymentCalldata: Buffer.from(calldata.getBuffer()) });

        this.file = details.file;
        this.decimals = details.decimals;
    }

    public async mintRaw(to: Address, amount: bigint): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(this.airdropSelector);

        const array: AddressMap<bigint> = new AddressMap();
        array.set(to, amount);

        calldata.writeAddressValueTuple(array);

        const buf = calldata.getBuffer();
        const result = await this.executeThrowOnError({
            calldata: buf,
            sender: this.deployer,
            txOrigin: this.deployer,
        });

        const response = result.response;
        if (!response) {
            this.dispose();
            throw result.error;
        }
    }
}
