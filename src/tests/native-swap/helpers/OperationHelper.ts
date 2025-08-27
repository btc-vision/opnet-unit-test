import { Address } from '@btc-vision/transaction';
import { TokenHelper } from './TokenHelper.js';

export class BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
    ) {}
}

export class CreatePoolOperation extends BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
        public tokenHelper: TokenHelper,
        public initialLiquidityAmount: bigint,
        public floorPrice: bigint,
    ) {
        super(address, throws, block);
    }
}

export class ListLiquidityOperation extends BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
        public tokenHelper: TokenHelper,
        public amountIn: bigint,
        public priority: boolean,
    ) {
        super(address, throws, block);
    }
}

export class RelistLiquidityOperation extends BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
        public tokenHelper: TokenHelper,
        public amountIn: bigint,
        public priority: boolean,
    ) {
        super(address, throws, block);
    }
}

export class CancelListingOperation extends BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
    ) {
        super(address, throws, block);
    }
}

export class ReserveOperation extends BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
        public tokenHelper: TokenHelper,
        public reserver: Address,
        public amountInSats: bigint,
        public minAmountOutTokens: bigint,
        public activationDelay: number,
        public feesAddress: string,
    ) {
        super(address, throws, block);
    }
}

export enum SwapOperationUTXOTypes {
    NO_UTXO,
    FULL_UTXO,
    PARTIAL_UTXO,
}

export class SwapOperation extends BaseOperation {
    constructor(
        public address: Address,
        public throws: boolean,
        public block: bigint,
        public UTXOType: SwapOperationUTXOTypes,
        public reservationId: bigint,
    ) {
        super(address, throws, block);
    }
}
