export interface ObjectId {
    $oid: string;
}

export interface BinaryData {
    $binary: {
        base64: string;
        subType: string;
    };
}

export interface Decimal128 {
    $numberDecimal: string;
}

export interface Int64 {
    $numberLong: string;
}

export interface Event {
    contractAddress: BinaryData;
    data: BinaryData;
    type: BinaryData;
}

export interface Input {
    originalTransactionId: BinaryData;
    outputTransactionIndex: number;
    scriptSignature: null;
    sequenceId: number;
}

export interface ScriptPubKey {
    hex: string;
    addresses: string[] | null;
    address: string;
}

export interface Output {
    value: Decimal128;
    index: number;
    scriptPubKey: ScriptPubKey;
}
export interface TransactionDocument {
    _id: ObjectId;
    blockHeight: Decimal128;
    hash: BinaryData;
    OPNetType: 'Interaction' | 'Generic';
    burnedBitcoin: Decimal128;
    calldata: BinaryData;
    contractAddress: string;
    contractSecret: BinaryData;
    contractTweakedPublicKey: BinaryData;
    events: Event[];
    from: BinaryData;
    gasUsed: Decimal128;
    id: BinaryData;
    index: number;
    inputs: Input[];
    interactionPubKey: BinaryData;
    outputs: Output[];
    preimage: BinaryData;
    priorityFee: Decimal128;
    raw: BinaryData;
    receipt: BinaryData;
    receiptProofs: string[];
    revert: null | BinaryData;
    reward: Int64;
    senderPubKeyHash: BinaryData;
    specialGasUsed: Decimal128;
    wasCompressed: boolean;
}
