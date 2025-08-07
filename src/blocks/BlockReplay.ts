import { Logger } from '@btc-vision/logger';
import { Transaction } from './Transaction.js';
import fs from 'fs';
import { TransactionDocument } from './interfaces/RawTransaction.js';
import { AddressSet } from '@btc-vision/transaction';
import { Blockchain } from '@btc-vision/unit-test-framework';

export interface BlockSettings {
    readonly blockHeight: bigint;
    readonly ignoreUnknownContracts: boolean;
}

export class BlockReplay extends Logger {
    public readonly logColor: string = '#0077ff';

    private readonly blockHeight: bigint;
    private readonly transactions: Transaction[] = [];

    constructor(private readonly settings: BlockSettings) {
        super();

        this.blockHeight = settings.blockHeight;

        this.loadTransactions();
    }

    public async replayBlock(): Promise<boolean> {
        const ready = this.verifyIfAllRequiredContractsArePresent();
        if (!ready) {
            this.fail(`Block ${this.blockHeight} replay failed due to missing contracts.`);
            return false;
        }

        await Promise.resolve();

        this.log(
            `Block ${this.blockHeight} replay started with ${this.transactions.length} transactions.`,
        );

        Blockchain.blockNumber = this.blockHeight;

        for (const tx of this.transactions) {
            if (this.settings.ignoreUnknownContracts) {
                if (!Blockchain.isContract(tx.contractTweakedPublicKey)) {
                    //this.info(`Ignored unknown contract ${tx.contractAddress}`);
                    continue;
                }
            }

            try {
                await tx.execute();
            } catch (e) {
                this.panic(
                    `Block ${this.blockHeight} transaction ${tx.id} execution failed -> ${e}`,
                );
                return false;
            }
        }

        return true;
    }

    private verifyIfAllRequiredContractsArePresent(): boolean {
        const contracts: AddressSet = new AddressSet();

        for (const tx of this.transactions) {
            if (contracts.has(tx.contractTweakedPublicKey)) {
                continue;
            }
            contracts.add(tx.contractTweakedPublicKey);

            if (
                !Blockchain.isContract(tx.contractTweakedPublicKey) &&
                !this.settings.ignoreUnknownContracts
            ) {
                this.fail(
                    `Block ${this.blockHeight} transaction ${tx.id} requires contract ${tx.contractTweakedPublicKey} to be present, but it is not registered.`,
                );
                return false;
            }
        }

        return true;
    }

    private loadTransactions(): void {
        const json = `./blocks/${this.blockHeight}.json`;
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
