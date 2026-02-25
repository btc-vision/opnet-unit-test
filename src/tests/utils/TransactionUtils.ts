import { Blockchain, generateEmptyTransaction, Transaction } from '@btc-vision/unit-test-framework';
import { Recipient } from '../../contracts/NativeSwapTypes.js';

export function createFeeOutput(
    value: bigint,
    recipient: string,
    proveFunds: string | undefined,
    funds: bigint | undefined,
): void {
    const tx: Transaction = generateEmptyTransaction();
    tx.addOutput(value, recipient);

    if (funds !== undefined && proveFunds !== undefined) {
        tx.addOutput(funds, proveFunds);
    }

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
