import { Address, ADDRESS_BYTE_LENGTH, BinaryWriter } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    generateTransactionId,
    Transaction,
    TransactionInput,
    TransactionOutput,
} from '@btc-vision/unit-test-framework';
import { TokenHelper } from './TokenHelper.js';
import { createRecipientUTXOs } from '../../utils/UTXOSimulator.js';
import { ripemd160 } from '@btc-vision/bitcoin';
import { ReserveLiquidityEventsHelper } from './ReserveLiquidityEventsHelper.js';
import {
    ILiquidityReservedEvent,
    IReservationCreatedEvent,
} from '../../../contracts/NativeSwapTypes.js';
import { ProviderHelper } from './ProviderHelper.js';
import { NativeSwap } from '../../../contracts/NativeSwap.js';

export class ReserveLiquidityRecipientHelper {
    constructor(
        public address: string,
        public amount: bigint,
        public providerId: bigint,
    ) {}
}

export class ReserveLiquidityHelper {
    public recipients: ReserveLiquidityRecipientHelper[] = [];
    public purged: boolean = false;
    public purgeIndex: number = 0;
    public swapped: boolean = false;
    public timeout: boolean = false;
    public purgedAmount: bigint = 0n;

    constructor(
        public tokenHelper: TokenHelper,
        public reserver: Address,
        public reservationId: bigint,
        public totalSatoshis: bigint,
        public expectedAmountOut: bigint,
        public creationBlock: bigint,
    ) {}

    public static async create(
        nativeSwap: NativeSwap,
        tokenHelper: TokenHelper,
        reserverAddress: Address,
        reservationCreatedEvent: IReservationCreatedEvent,
        liquidityReservedEvents: ILiquidityReservedEvent[],
        providerArray: ProviderHelper[],
    ): Promise<ReserveLiquidityHelper> {
        const reservation = new ReserveLiquidityHelper(
            tokenHelper,
            reserverAddress,
            generateReservationId(tokenHelper.token.address, reserverAddress),
            reservationCreatedEvent.totalSatoshis,
            reservationCreatedEvent.expectedAmountOut,
            Blockchain.blockNumber,
        );

        for (let i = 0; i < liquidityReservedEvents.length; i++) {
            const item = liquidityReservedEvents[i];

            reservation.recipients.push(
                new ReserveLiquidityRecipientHelper(
                    item.depositAddress,
                    item.amount,
                    item.providerId,
                ),
            );

            const provider = providerArray.find((p) => p.id === item.providerId);

            if (provider === undefined || provider === null) {
                throw new Error(`Provider not found. pid: ${item.providerId}`);
            }

            await provider.update(nativeSwap);
        }

        return reservation;
    }

    public isExpired(): boolean {
        return Blockchain.blockNumber > this.creationBlock + 5n;
    }

    public createTransaction(): Transaction {
        const inputs: TransactionInput[] = [];
        const outputs: TransactionOutput[] = [];
        const transaction = new Transaction(generateTransactionId(), inputs, outputs);

        for (let i = 0; i < this.recipients.length; i++) {
            transaction.addOutput(this.recipients[i].amount, this.recipients[i].address);
        }

        return transaction;
    }

    public logToConsole(): void {
        Blockchain.log('RESERVATION INFO');
        Blockchain.log('----------');
        Blockchain.log(`name: ${this.tokenHelper.name}`);
        Blockchain.log(`address: ${this.tokenHelper.token.address}`);
        Blockchain.log(`reserver: ${this.reserver}`);
        Blockchain.log(`reservationId: ${this.reservationId}`);
        Blockchain.log(`totalSatoshis: ${this.totalSatoshis}`);
        Blockchain.log(`expectedAmountOut: ${this.expectedAmountOut}`);
        Blockchain.log(`creationBlock: ${this.creationBlock}`);
        Blockchain.log(`isExpired: ${this.isExpired()}`);
        Blockchain.log(`purged: ${this.purged}`);
        Blockchain.log(`purgeIndex: ${this.purgeIndex}`);
        Blockchain.log(`swapped: ${this.swapped}`);
        Blockchain.log(`timeout: ${this.timeout}`);
        Blockchain.log(`purgedAmount: ${this.purgedAmount}`);

        for (let i = 0; i < this.recipients.length; i++) {
            Blockchain.log('');
            Blockchain.log(`\trecipient${i}`);
            Blockchain.log('\t----------');
            Blockchain.log(`\taddress: ${this.recipients[i].address}`);
            Blockchain.log(`\tproviderId: ${this.recipients[i].providerId}`);
            Blockchain.log(`\tamount: ${this.recipients[i].amount}`);
            Blockchain.log('');
        }
        Blockchain.log('');
    }
}

export function generateReservationId(token: Address, owner: Address): bigint {
    const writer: BinaryWriter = new BinaryWriter(ADDRESS_BYTE_LENGTH * 2);
    writer.writeAddress(token);
    writer.writeAddress(owner);

    const buf: Buffer = Buffer.from(writer.getBuffer());
    const hash: Uint8Array = ripemd160(buf);

    // only use the first 16 bytes (fit 128 bits)
    // this is a design choice. the odds that two ACTIVE reservations have the same ID is 1 in 2^128
    return hash.slice(0, 16).reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}
