import {
    Blockchain,
    generateTransactionId,
    Transaction,
    TransactionInput,
    TransactionOutput,
} from '@btc-vision/unit-test-framework';
import { Recipient } from '../../contracts/ewma/NativeSwapTypes.js';

export function generateEmptyTransaction(): Transaction {
    const txId = generateTransactionId();

    const inputs: TransactionInput[] = [];
    const outputs: TransactionOutput[] = [];

    return new Transaction(txId, inputs, outputs);
}

export function createRecipientUTXOs(recipients: Recipient[]): void {
    // Create a new transaction.
    const tx: Transaction = generateEmptyTransaction();
    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        tx.addOutput(recipient.amount, recipient.address);
    }

    Blockchain.transaction = tx;
}
