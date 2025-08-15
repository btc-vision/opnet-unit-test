import { Address } from '@btc-vision/transaction';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { helper_getProviderDetailsNew } from '../../utils/OperationHelperNew.js';
import { Blockchain } from '@btc-vision/unit-test-framework';
import { TokenHelper } from './TokenHelper.js';
import { GetProviderDetailsResult } from '../../../contracts/NativeSwapTypes.js';
import { logAction, logGetProviderDetailsResult } from '../../utils/LoggerHelper.js';

export class ProviderHelper {
    public id: bigint;
    public liquidity: bigint;
    public reserved: bigint;
    public btcReceiver: string;
    public queueIndex: number;
    public isPriority: boolean;
    public purgeIndex: number;
    public isActive: boolean;
    public listedTokenAt: bigint;
    public isPurged: boolean;
    public isFullfiled: boolean;

    constructor(
        public address: Address,
        public tokenHelper: TokenHelper,
        public priority: boolean = false,
        public initialLiquidityProvider: boolean = false,
    ) {
        this.id = 0n;
        this.liquidity = 0n;
        this.reserved = 0n;
        this.btcReceiver = '';
        this.queueIndex = 0;
        this.isPriority = priority;
        this.purgeIndex = 0;
        this.isActive = false;
        this.listedTokenAt = 0n;
        this.isPurged = false;
        this.isFullfiled = false;
    }

    public async update(nativeSwap: NativeSwap): Promise<void> {
        const msgSender = Blockchain.msgSender;
        const txOrigin = Blockchain.txOrigin;
        Blockchain.msgSender = this.address;
        Blockchain.txOrigin = this.address;

        const result = await nativeSwap.getProviderDetails({
            token: this.tokenHelper.token.address,
        });

        Blockchain.msgSender = msgSender;
        Blockchain.txOrigin = txOrigin;

        this.id = result.id;
        this.liquidity = result.liquidity;
        this.reserved = result.reserved;
        this.btcReceiver = result.btcReceiver;
        this.queueIndex = result.queueIndex;
        this.isPriority = result.isPriority;
        this.purgeIndex = result.purgeIndex;
        this.isActive = result.isActive;
        this.listedTokenAt = result.listedTokenAt;
        this.isPurged = result.isPurged;
    }

    public setFulfilled(value: boolean): void {
        this.isFullfiled = value;
    }

    public async getBalance(): Promise<bigint> {
        return await this.tokenHelper.token.balanceOf(this.address);
    }

    public async logToConsole(): Promise<void> {
        Blockchain.log('PROVIDER INFO');
        Blockchain.log('----------');
        Blockchain.log(`id: ${this.id}`);
        Blockchain.log(`address: ${this.address}`);
        Blockchain.log(`token name: ${this.tokenHelper.name}`);
        Blockchain.log(`liquidity: ${this.liquidity}`);
        Blockchain.log(`reserved: ${this.reserved}`);
        Blockchain.log(`provider token balance: ${await this.getBalance()}`);
        Blockchain.log(`btcReceiver: ${this.btcReceiver}`);
        Blockchain.log(`queueIndex: ${this.queueIndex}`);
        Blockchain.log(`purgeIndex: ${this.purgeIndex}`);
        Blockchain.log(`isPriority: ${this.isPriority}`);
        Blockchain.log(`isActive: ${this.isActive}`);
        Blockchain.log(`isPurged: ${this.isPurged}`);
        Blockchain.log(`isFullfiled: ${this.isFullfiled}`);
        Blockchain.log(`listedTokenAt: ${this.listedTokenAt}`);
        Blockchain.log(`initialLiquidityProvider: ${this.initialLiquidityProvider}`);
        Blockchain.log('');
    }
}
