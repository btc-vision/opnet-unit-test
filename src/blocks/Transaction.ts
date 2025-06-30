import { Logger } from '@btc-vision/logger';
import {
    TransactionDocument,
    ObjectId,
    BinaryData,
    Decimal128,
    Int64,
    Event,
    Input,
    Output,
    ScriptPubKey,
} from './interfaces/RawTransaction.js';
import { Address } from '@btc-vision/transaction';

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
    readonly logColor = '#0077ff';

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
    readonly from: Buffer;
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

        this.from = Transaction.binaryToBuffer(raw.from);
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
            from: Transaction.bufferToBinary(this.from),
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

    private static bufferToBinary(buf: Buffer): BinaryData {
        return {
            $binary: {
                base64: buf.toString('base64'),
                subType: '00',
            },
        };
    }
}
