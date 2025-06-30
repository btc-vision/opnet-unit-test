import { Logger } from '@btc-vision/logger';
import {
    BinaryData,
    Decimal128,
    Event,
    Input,
    Int64,
    ObjectId,
    Output,
    ScriptPubKey,
    TransactionDocument,
} from './interfaces/RawTransaction.js';
import { Address } from '@btc-vision/transaction';

import {
    Blockchain,
    generateEmptyTransaction,
    RustContract,
    Transaction as BitcoinTransaction,
} from '@btc-vision/unit-test-framework';

export interface ParsedEvent {
    contractAddress: Address;
    data: Buffer;
    type: Buffer;
}

export interface ParsedInput {
    originalTransactionId: Buffer;
    outputTransactionIndex: number;
    scriptSignature: null;
    sequenceId: number;
}

export interface ParsedOutput {
    value: bigint;
    index: number;
    scriptPubKey: {
        hex: string;
        addresses: string[] | null;
        address: string;
    };
}

export class Transaction extends Logger {
    readonly logColor = '#fde084';

    readonly id: string;
    readonly blockHeight: bigint;
    readonly hash: Buffer;
    readonly opNetType: 'Interaction' | 'Generic';
    readonly burnedBitcoin: bigint;
    readonly calldata: Buffer;
    readonly contractAddress: string;
    readonly contractSecret: Buffer;
    readonly contractTweakedPublicKey: Address;

    readonly events: ParsedEvent[];
    readonly from: Address;
    readonly gasUsed: bigint;
    readonly txId: Buffer;
    readonly index: number;
    readonly inputs: ParsedInput[];
    readonly interactionPubKey: Buffer;
    readonly outputs: ParsedOutput[];
    readonly preimage: Buffer;
    readonly priorityFee: bigint;
    readonly raw: Buffer;
    readonly receipt: Buffer;
    readonly receiptProofs: string[];
    readonly revert: Buffer | null;
    readonly reward: bigint;
    readonly senderPubKeyHash: Buffer;
    readonly specialGasUsed: bigint;
    readonly wasCompressed: boolean;

    constructor(raw: TransactionDocument) {
        super();

        this.id = Transaction.objectIdToString(raw._id);
        this.blockHeight = Transaction.decimal128ToBigint(raw.blockHeight);
        this.hash = Transaction.binaryToBuffer(raw.hash);
        this.opNetType = raw.OPNetType;
        this.burnedBitcoin = Transaction.decimal128ToBigint(raw.burnedBitcoin);
        this.calldata = Transaction.binaryToBuffer(raw.calldata);
        this.contractAddress = raw.contractAddress;
        this.contractSecret = Transaction.binaryToBuffer(raw.contractSecret);
        this.contractTweakedPublicKey = new Address(
            Transaction.binaryToBuffer(raw.contractTweakedPublicKey),
        );

        this.from = new Address(Transaction.binaryToBuffer(raw.from));
        this.gasUsed = Transaction.decimal128ToBigint(raw.gasUsed);
        this.txId = Transaction.binaryToBuffer(raw.id);
        this.index = raw.index;
        this.interactionPubKey = Transaction.binaryToBuffer(raw.interactionPubKey);
        this.preimage = Transaction.binaryToBuffer(raw.preimage);
        this.priorityFee = Transaction.decimal128ToBigint(raw.priorityFee);
        this.raw = Transaction.binaryToBuffer(raw.raw);
        this.receipt = Transaction.binaryToBuffer(raw.receipt);
        this.receiptProofs = [...raw.receiptProofs];
        this.revert = raw.revert ? Transaction.binaryToBuffer(raw.revert) : null;
        this.reward = Transaction.int64ToBigint(raw.reward);
        this.senderPubKeyHash = Transaction.binaryToBuffer(raw.senderPubKeyHash);
        this.specialGasUsed = Transaction.decimal128ToBigint(raw.specialGasUsed);
        this.wasCompressed = raw.wasCompressed;

        this.events = raw.events.map(Transaction.parseEvent);
        this.inputs = raw.inputs.map(Transaction.parseInput);
        this.outputs = raw.outputs.map(Transaction.parseOutput);
    }

    private static objectIdToString(id: ObjectId): string {
        return id.$oid;
    }

    private static binaryToBuffer(data: BinaryData): Buffer {
        return Buffer.from(data.$binary.base64, 'base64');
    }

    private static decimal128ToBigint(d: Decimal128): bigint {
        return BigInt(d.$numberDecimal);
    }

    private static int64ToBigint(i: Int64): bigint {
        return BigInt(i.$numberLong);
    }

    private static parseEvent(evt: Event): ParsedEvent {
        return {
            contractAddress: new Address(Transaction.binaryToBuffer(evt.contractAddress)),
            data: Transaction.binaryToBuffer(evt.data),
            type: Transaction.binaryToBuffer(evt.type),
        };
    }

    private static parseInput(input: Input): ParsedInput {
        return {
            originalTransactionId: Transaction.binaryToBuffer(input.originalTransactionId),
            outputTransactionIndex: input.outputTransactionIndex,
            scriptSignature: input.scriptSignature,
            sequenceId: input.sequenceId,
        };
    }

    private static parseOutput(out: Output): ParsedOutput {
        return {
            value: Transaction.decimal128ToBigint(out.value),
            index: out.index,
            scriptPubKey: Transaction.parseScriptPubKey(out.scriptPubKey),
        };
    }

    private static parseScriptPubKey(spk: ScriptPubKey): ScriptPubKey {
        return {
            hex: spk.hex,
            addresses: spk.addresses ? [...spk.addresses] : null,
            address: spk.address,
        };
    }

    private static bufferToBinary(buf: Buffer): BinaryData {
        return {
            $binary: {
                base64: buf.toString('base64'),
                subType: '00',
            },
        };
    }

    public async execute(): Promise<void> {
        const txId = this.txId.toString('hex');

        //this.debugBright(`Executing transaction ${txId}.`);

        const contract = Blockchain.getContract(this.contractTweakedPublicKey);

        const tx: BitcoinTransaction = generateEmptyTransaction(false);
        this.createInputs(tx);
        this.createOutputs(tx);

        Blockchain.transaction = tx;

        const t = Date.now();
        const result = await contract.execute({
            calldata: this.calldata,
            sender: this.from,
            txOrigin: this.from,
        });

        if (result.error) {
            this.fail(
                `Executed transaction ${txId} for contract ${this.contractAddress}. (Took ${Date.now() - t}ms to execute, ${result.usedGas} gas used)\n\n${result.error.message}\n`,
            );

            if (this.revert) {
                this.fail(
                    `Original error for ${txId}: ${RustContract.decodeRevertData(this.revert)}`,
                );
            } else {
                this.logTransactionDetails();

                throw new Error(
                    `This transaction has no revert in the block you are replaying. This transaction should have passed but it reverted.`,
                );
            }
        } else {
            this.debug(
                `Executed transaction ${txId} for contract ${this.contractAddress}. (Took ${Date.now() - t}ms to execute, ${result.usedGas} gas used)`,
            );
        }
    }

    public logTransactionDetails(): void {
        const toHex = (v: Buffer | null): string => (v ? `0x${v.toString('hex')}` : 'null');

        const toBig = (v: bigint | null | undefined): string =>
            v === null || v === undefined ? 'null' : v.toString();

        const out: string[] = [];

        out.push('---- Replayed Transaction Dump ----');
        out.push(`id                       : ${this.id}`);
        out.push(`blockHeight              : ${this.blockHeight}`);
        out.push(`hash                     : ${toHex(this.hash)}`);
        out.push(`opNetType                : ${this.opNetType}`);
        out.push(`burnedBitcoin            : ${toBig(this.burnedBitcoin)}`);
        out.push(`calldata                 : ${toHex(this.calldata)}`);
        out.push(`contractAddress          : ${this.contractAddress}`);
        out.push(`contractSecret           : ${toHex(this.contractSecret)}`);
        out.push(`contractTweakedPublicKey : ${this.contractTweakedPublicKey.toString()}`);
        out.push(`from                     : ${this.from.toString()}`);
        out.push(`gasUsed                  : ${toBig(this.gasUsed)}`);
        out.push(`txId                     : ${toHex(this.txId)}`);
        out.push(`index                    : ${this.index}`);
        out.push(`interactionPubKey        : ${toHex(this.interactionPubKey)}`);
        out.push(`preimage                 : ${toHex(this.preimage)}`);
        out.push(`priorityFee              : ${toBig(this.priorityFee)}`);
        out.push(`raw                      : ${toHex(this.raw)}`);
        out.push(`receipt                  : ${toHex(this.receipt)}`);
        out.push(`revert                   : ${this.revert ? toHex(this.revert) : 'no-revert'}`);
        out.push(`reward                   : ${toBig(this.reward)}`);
        out.push(`senderPubKeyHash         : ${toHex(this.senderPubKeyHash)}`);
        out.push(`specialGasUsed           : ${toBig(this.specialGasUsed)}`);
        out.push(`wasCompressed            : ${this.wasCompressed}`);
        out.push('');

        out.push(`inputs (${this.inputs.length})`);
        this.inputs.forEach((i, idx) => {
            out.push(
                `  [${idx}] tx=${toHex(i.originalTransactionId)} / vout=${
                    i.outputTransactionIndex
                } / sequence=${i.sequenceId}`,
            );
        });
        if (this.inputs.length === 0) out.push('  <none>');
        out.push('');

        out.push(`outputs (${this.outputs.length})`);
        this.outputs.forEach((o, idx) => {
            const addrPart =
                o.scriptPubKey.addresses?.length === 1
                    ? o.scriptPubKey.addresses[0]
                    : o.scriptPubKey.addresses;
            out.push(
                `  [${idx}] value=${toBig(o.value)} / index=${
                    o.index
                } / script=${o.scriptPubKey.hex} / address=${addrPart}`,
            );
        });
        if (this.outputs.length === 0) out.push('  <none>');
        out.push('');

        out.push(`events (${this.events.length})`);
        this.events.forEach((e, idx) => {
            out.push(
                `  [${idx}] contract=${e.contractAddress.toString()} / type=${e.type.toString()} / data=${toHex(e.data)}`,
            );
        });
        if (this.events.length === 0) out.push('  <none>');
        out.push('');

        out.push(`receiptProofs (${this.receiptProofs.length})`);
        this.receiptProofs.forEach((r, idx) => out.push(`  [${idx}] ${r}`));
        if (this.receiptProofs.length === 0) out.push('  <none>');
        out.push('---- End Dump ----\n');

        this.debugBright(out.join('\n'));
    }

    public toRaw(): TransactionDocument {
        return {
            _id: { $oid: this.id },
            blockHeight: { $numberDecimal: this.blockHeight.toString() },
            hash: Transaction.bufferToBinary(this.hash),
            OPNetType: this.opNetType,
            burnedBitcoin: { $numberDecimal: this.burnedBitcoin.toString() },
            calldata: Transaction.bufferToBinary(this.calldata),
            contractAddress: this.contractAddress,
            contractSecret: Transaction.bufferToBinary(this.contractSecret),
            contractTweakedPublicKey: Transaction.bufferToBinary(
                this.contractTweakedPublicKey.toBuffer(),
            ),
            events: this.events.map((e) => ({
                contractAddress: Transaction.bufferToBinary(e.contractAddress.toBuffer()),
                data: Transaction.bufferToBinary(e.data),
                type: Transaction.bufferToBinary(e.type),
            })),
            from: Transaction.bufferToBinary(this.from.toBuffer()),
            gasUsed: { $numberDecimal: this.gasUsed.toString() },
            id: Transaction.bufferToBinary(this.txId),
            index: this.index,
            inputs: this.inputs.map((i) => ({
                originalTransactionId: Transaction.bufferToBinary(i.originalTransactionId),
                outputTransactionIndex: i.outputTransactionIndex,
                scriptSignature: i.scriptSignature,
                sequenceId: i.sequenceId,
            })),
            interactionPubKey: Transaction.bufferToBinary(this.interactionPubKey),
            outputs: this.outputs.map((o) => ({
                value: { $numberDecimal: o.value.toString() },
                index: o.index,
                scriptPubKey: {
                    hex: o.scriptPubKey.hex,
                    addresses: o.scriptPubKey.addresses ? [...o.scriptPubKey.addresses] : null,
                    address: o.scriptPubKey.address,
                },
            })),
            preimage: Transaction.bufferToBinary(this.preimage),
            priorityFee: { $numberDecimal: this.priorityFee.toString() },
            raw: Transaction.bufferToBinary(this.raw),
            receipt: Transaction.bufferToBinary(this.receipt),
            receiptProofs: [...this.receiptProofs],
            revert: this.revert ? Transaction.bufferToBinary(this.revert) : null,
            reward: { $numberLong: this.reward.toString() },
            senderPubKeyHash: Transaction.bufferToBinary(this.senderPubKeyHash),
            specialGasUsed: { $numberDecimal: this.specialGasUsed.toString() },
            wasCompressed: this.wasCompressed,
        };
    }

    private createInputs(tx: BitcoinTransaction): void {
        for (const input of this.inputs) {
            tx.addInput(
                Uint8Array.from(input.originalTransactionId),
                input.outputTransactionIndex,
                input.scriptSignature ?? Uint8Array.from([]),
            );
        }
    }

    private createOutputs(tx: BitcoinTransaction): void {
        for (const output of this.outputs) {
            tx.addOutput(
                output.value,
                output.scriptPubKey.address,
                Uint8Array.from(Buffer.from(output.scriptPubKey.hex || '', 'hex')),
            );
        }
    }
}
