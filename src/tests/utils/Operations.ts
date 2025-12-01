import { Address } from '@btc-vision/transaction';
import { TokenHelper } from '../native-swap/helpers/TokenHelper.js';
import { Assert, generateTransactionId, Transaction } from '@btc-vision/unit-test-framework';
import { OperationsHelper } from '../native-swap/helpers/OperationsHelper.js';
import { ProviderHelper } from '../native-swap/helpers/ProviderHelper.js';
import { ReserveLiquidityHelper } from '../native-swap/helpers/ReserveLiquidityHelper.js';

export class BaseOperation {}

export class CreatePoolOperation extends BaseOperation {
    constructor(
        public tokenHelper: TokenHelper,
        public initialLiquidityAmount: bigint,
        public floorPrice: bigint,
    ) {
        super();
    }

    public async execute(operationHelper: OperationsHelper): Promise<ProviderHelper> {
        const provider = await operationHelper.createPool(
            this.tokenHelper,
            this.initialLiquidityAmount,
            this.floorPrice,
        );

        return provider;
    }
}

export class ListLiquidityOperation extends BaseOperation {
    constructor(
        public address: Address,
        public tokenHelper: TokenHelper,
        public amountIn: bigint,
        public priority: boolean,
        public checkReset: boolean = false,
        public expectedReset: number = 0,
        public checkPurged: boolean = false,
        public expectedPurged: number = 0,
    ) {
        super();
    }

    public async execute(operationHelper: OperationsHelper): Promise<ProviderHelper> {
        const result = await operationHelper.listLiquidity(
            this.tokenHelper,
            this.address,
            this.amountIn,
            this.priority,
            this.checkReset,
            this.expectedReset,
            this.checkPurged,
            this.expectedPurged,
        );

        return result;
    }
}

export class RelistLiquidityOperation extends BaseOperation {
    constructor(
        public address: Address,
        public tokenHelper: TokenHelper,
        public amountIn: bigint,
        public priority: boolean,
        public checkReset: boolean = false,
        public expectedReset: number = 0,
        public checkPurged: boolean = false,
        public expectedPurged: number = 0,
    ) {
        super();
    }
    public async execute(operationHelper: OperationsHelper): Promise<void> {
        const provider = operationHelper.getProviderByAddress(this.address);

        Assert.expect(provider).toNotEqual(null);
        if (provider === null) {
            throw new Error(`Provider ${this.address} not found`);
        }

        await operationHelper.relistLiquidity(
            provider,
            this.amountIn,
            this.priority,
            this.checkReset,
            this.expectedReset,
            this.checkPurged,
            this.expectedPurged,
        );
    }
}

export class ReserveOperation extends BaseOperation {
    constructor(
        public tokenHelper: TokenHelper,
        public reserver: Address,
        public amountInSats: bigint,
        public minAmountOutTokens: bigint,
        public activationDelay: number,
        public feesAddress: string = '',
    ) {
        super();
    }

    public async execute(operationHelper: OperationsHelper): Promise<ReserveLiquidityHelper> {
        return await operationHelper.reserveLiquidity(
            this.tokenHelper,
            this.reserver,
            this.amountInSats,
            this.minAmountOutTokens,
            this.activationDelay,
            this.feesAddress,
        );
    }
}

export enum SwapOperationUTXOTypes {
    NO_UTXO,
    FULL_UTXO,
    PARTIAL_UTXO,
}

export class SwapOperation extends BaseOperation {
    constructor(
        public UTXOType: SwapOperationUTXOTypes,
        public reservationId: bigint,
    ) {
        super();
    }

    public async execute(operationHelper: OperationsHelper): Promise<void> {
        const reservation = operationHelper.getReservation(this.reservationId);

        Assert.expect(reservation).toNotEqual(null);
        if (reservation === null) {
            throw new Error(`Reservation don't exists ${this.reservationId}`);
        }

        let transaction: Transaction;

        switch (this.UTXOType) {
            case SwapOperationUTXOTypes.FULL_UTXO:
                transaction = reservation.createTransaction();
                break;
            case SwapOperationUTXOTypes.PARTIAL_UTXO:
                transaction = reservation.createTransaction();
                break;
            case SwapOperationUTXOTypes.NO_UTXO:
                transaction = new Transaction(generateTransactionId(), [], []);
                break;
            default:
                throw new Error('Unsupported UTXO type');
        }

        await operationHelper.swap(reservation, transaction);
    }
}
