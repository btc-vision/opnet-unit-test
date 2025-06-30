import { Logger } from '@btc-vision/logger';
import { Transaction } from './Transaction.js';
import fs from 'fs';
import { TransactionDocument } from './interfaces/RawTransaction.js';
import { AddressSet } from '@btc-vision/transaction';
import { Blockchain } from '@btc-vision/unit-test-framework';

export class BlockReplay extends Logger {
    public readonly logColor: string = '#0077ff';

    private readonly transactions: Transaction[] = [];

    constructor(private readonly blockHeight: bigint) {
        super();

        this.loadTransactions();
    }

    public getBlockHeight(): bigint {
        return this.blockHeight;
    }

    public async replayBlock(): Promise<void> {
        const ready = this.verifyIfAllRequiredContractsArePresent();

        if (!ready) {
            this.fail(`Block ${this.blockHeight} replay failed due to missing contracts.`);
            return;
        }

        await Promise.resolve();
    }

    private verifyIfAllRequiredContractsArePresent(): boolean {
        const contracts: AddressSet = new AddressSet();

        for (const tx of this.transactions) {
            if (contracts.has(tx.contractTweakedPublicKey)) {
                continue;
            }
            contracts.add(tx.contractTweakedPublicKey);

            try {
                Blockchain.getContract(tx.contractTweakedPublicKey);
            } catch (e) {
                this.fail(
                    `Contract ${tx.contractTweakedPublicKey} not found in block ${this.blockHeight} -> ${e}`,
                );

                return false;
            }
        }

        return true;
    }

    private loadTransactions(): void {
        const json = `./block/${this.blockHeight}.json`;
        try {
            const data = fs.readFileSync(json, 'utf8');
            const txs = JSON.parse(data) as TransactionDocument[];

            for (const tx of txs) {
                this.transactions.push(new Transaction(tx));
            }
        } catch (e) {
            this.fail(
                `Coudnt load block ${this.blockHeight} transactions from file ${json} -> ${e}`,
            );
        }
    }
}
