import {
    Blockchain,
    generateTransactionId,
    Transaction,
    TransactionInput,
    TransactionOutput,
} from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient } from '../../contracts/NativeSwapTypes.js';

export function generateEmptyTransaction(): Transaction {
    const txId = generateTransactionId();

    const inputs: TransactionInput[] = [];
    const outputs: TransactionOutput[] = [];

    return new Transaction(txId, inputs, outputs);
}

export function createFeeOutput(value: bigint, recipient: string = NativeSwap.feeRecipient): void {
    const tx: Transaction = generateEmptyTransaction();
    tx.addOutput(value, recipient);

    Blockchain.transaction = tx;
}

export function createRecipientsOutput(recipients: Recipient[]): void {
    // Create a new transaction.
    const tx: Transaction = generateEmptyTransaction();
    for (const recipient of recipients) {
        tx.addOutput(recipient.amount, recipient.address);
    }

    Blockchain.transaction = tx;
}

export function gas2Sat(gas: bigint): bigint {
    return gas / 1_000_000n;
}

export function sat2BTC(satoshis: bigint): number {
    return Number(satoshis) / 100_000_000;
}

export function gas2BTC(gas: bigint): number {
    return sat2BTC(gas2Sat(gas));
}

export function gas2USD(gas: bigint, btcPrice: number = 78_000): number {
    return gas2BTC(gas) * btcPrice;
}
