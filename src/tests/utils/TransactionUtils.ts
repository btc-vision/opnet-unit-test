import { Blockchain, generateEmptyTransaction, Transaction } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient } from '../../contracts/NativeSwapTypes.js';
import { networks } from '@btc-vision/bitcoin';

export function createFeeOutput(value: bigint, recipient: string = NativeSwap.feeRecipient): void {
    if (Blockchain.network.bech32 === networks.testnet.bech32) {
        recipient = NativeSwap.feeRecipientTestnet;
    }

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

const QUOTE_SCALE = 100_000_000n;

export function tokensToSatoshis(tokenAmount: bigint, scaledPrice: bigint): bigint {
    return ((tokenAmount + 1n) * QUOTE_SCALE) / scaledPrice;
}
