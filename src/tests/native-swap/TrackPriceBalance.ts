import { Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { helper_getProviderDetails, helper_getReserve } from '../utils/OperationHelper.js';
import { Address } from '@btc-vision/transaction';
import {
    helper_cancelLiquidityNew,
    helper_createPoolNew,
    helper_createTokenNew,
    helper_getProviderDetailsNew,
    helper_getReserveNew,
    helper_listLiquidityNew,
} from '../utils/OperationHelperNew.js';

class TokenInfo {
    public isPoolCreated: boolean = false;
    private priceAtBlock: Map<number, bigint> = new Map();
    private initialLiquidityProviderAddress: Address;

    constructor(
        public token: OP20,
        public ownerAddress: Address,
        public stakingContractAddress: Address,
        public nativeSwapContractAddress: Address,
        public name: string,
    ) {
        this.initialLiquidityProviderAddress = new Address();
    }

    public setPriceAtBlock(blockNumber: number, price: bigint) {
        this.priceAtBlock.set(blockNumber, price);
    }

    public getPriceAtBlock(blockNumber: number): bigint | undefined {
        return this.priceAtBlock.get(blockNumber);
    }

    public async getStakingContractBalance(): Promise<bigint> {
        return await this.token.balanceOf(this.stakingContractAddress);
    }

    public async getNativeSwapContractBalance(): Promise<bigint> {
        return await this.token.balanceOf(this.nativeSwapContractAddress);
    }

    public setInitialLiquidityProviderAddress(address: Address): void {
        this.initialLiquidityProviderAddress = address;
    }

    public getInitialLiquidityProviderAddress(): Address {
        return this.initialLiquidityProviderAddress;
    }

    public async logToConsole(): Promise<void> {
        Blockchain.log('TOKEN INFO');
        Blockchain.log('----------');
        Blockchain.log(`name: ${this.name}`);
        Blockchain.log(`address: ${this.token.address}`);
        Blockchain.log(
            `initial liquidity provider address: ${this.getInitialLiquidityProviderAddress()}`,
        );
        Blockchain.log(`NativeSwapContractBalance: ${await this.getNativeSwapContractBalance()}`);
        Blockchain.log(`StakingContractBalance: ${await this.getStakingContractBalance()}`);
        Blockchain.log('');
    }
}

class ProviderInfo {
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
        public amountIn: bigint,
        public tokenInfo: TokenInfo,
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
        const result = await helper_getProviderDetailsNew(
            nativeSwap,
            this.tokenInfo.token.address,
            false,
        );

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
        return await this.tokenInfo.token.balanceOf(this.address);
    }

    public async logToConsole(): Promise<void> {
        Blockchain.log('PROVIDER INFO');
        Blockchain.log('----------');
        Blockchain.log(`id: ${this.id}`);
        Blockchain.log(`address: ${this.address}`);
        Blockchain.log(`token name: ${this.tokenInfo.name}`);
        Blockchain.log(`amountIn: ${this.amountIn}`);
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

class ReserveInfo {
    public liquidity: bigint;
    public reservedLiquidity: bigint;
    public virtualBTCReserve: bigint;
    public virtualTokenReserve: bigint;

    constructor(public tokenInfo: TokenInfo) {
        this.liquidity = 0n;
        this.reservedLiquidity = 0n;
        this.virtualBTCReserve = 0n;
        this.virtualTokenReserve = 0n;
    }

    public async update(nativeSwap: NativeSwap): Promise<void> {
        const result = await helper_getReserveNew(nativeSwap, this.tokenInfo.token, false);

        this.liquidity = result.liquidity;
        this.reservedLiquidity = result.reservedLiquidity;
        this.virtualBTCReserve = result.virtualBTCReserve;
        this.virtualTokenReserve = result.virtualTokenReserve;
    }
}

await opnet('Native Swap - Track price and balance', async (vm: OPNetUnit) => {
    const nativeSwapOwnerAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapContractAddress: Address = Blockchain.generateRandomAddress();
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    let nativeSwap: NativeSwap;
    let tokenArray: TokenInfo[] = [];
    let providerArray: ProviderInfo[] = [];

    let origin: Address;
    let sender: Address;

    function expandBigIntTo18Decimals(n: bigint): bigint {
        return n * 10n ** 18n;
    }

    function expandNumberTo18Decimals(n: number): bigint {
        return BigInt(n) * 10n ** 18n;
    }

    function pushOriginSender(): void {
        origin = Blockchain.txOrigin;
        sender = Blockchain.msgSender;
    }

    function popOriginSender(): void {
        Blockchain.txOrigin = origin;
        Blockchain.msgSender = sender;
    }

    async function initBlockchain(): Promise<void> {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
    }

    async function initNativeSwap(): Promise<void> {
        nativeSwap = new NativeSwap(nativeSwapOwnerAddress, nativeSwapContractAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        pushOriginSender();
        Blockchain.txOrigin = nativeSwapOwnerAddress;
        Blockchain.msgSender = nativeSwapOwnerAddress;
        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
        popOriginSender();
    }

    async function createTokens(): Promise<void> {
        for (let i = 0; i < 10; i++) {
            const ownerAddress: Address = Blockchain.generateRandomAddress();
            const token = await helper_createTokenNew(
                ownerAddress,
                18,
                expandNumberTo18Decimals(10000000),
            );

            tokenArray.push(
                new TokenInfo(
                    token,
                    ownerAddress,
                    stakingContractAddress,
                    nativeSwapContractAddress,
                    `TOKEN_${i}`,
                ),
            );
        }
    }

    function disposeTokens(): void {
        for (let i = 0; i < 10; i++) {
            tokenArray[i].token.dispose();
        }

        tokenArray = [];
    }

    async function createPool(
        tokenInfo: TokenInfo,
        initialLiquidityAmount: bigint,
        floorPrice: bigint,
    ): Promise<ProviderInfo> {
        pushOriginSender();

        await helper_createPoolNew(
            nativeSwap,
            tokenInfo.token,
            tokenInfo.ownerAddress,
            tokenInfo.ownerAddress,
            floorPrice,
            initialLiquidityAmount,
            100,
            false,
            true,
        );

        tokenInfo.isPoolCreated = true;

        const provider: ProviderInfo = new ProviderInfo(
            tokenInfo.ownerAddress,
            initialLiquidityAmount,
            tokenInfo,
            false,
            true,
        );

        tokenInfo.setInitialLiquidityProviderAddress(provider.address);

        await provider.update(nativeSwap);

        popOriginSender();

        return provider;
    }

    async function listLiquidity(providerInfo: ProviderInfo): Promise<void> {
        pushOriginSender();

        await providerInfo.tokenInfo.token.mintRaw(providerInfo.address, providerInfo.amountIn);
        await providerInfo.tokenInfo.token.increaseAllowance(
            providerInfo.address,
            nativeSwap.address,
            providerInfo.amountIn,
        );

        await helper_listLiquidityNew(
            nativeSwap,
            providerInfo.tokenInfo.token.address,
            providerInfo.address,
            providerInfo.amountIn,
            providerInfo.priority,
            providerInfo.address,
            false,
            false,
        );

        await providerInfo.update(nativeSwap);

        popOriginSender();
    }

    async function cancelLiquidity(providerInfo: ProviderInfo): Promise<void> {
        pushOriginSender();

        await helper_cancelLiquidityNew(
            nativeSwap,
            providerInfo.tokenInfo.token.address,
            providerInfo.address,
            false,
        );

        await providerInfo.update(nativeSwap);

        popOriginSender();
    }

    vm.beforeEach(async () => {
        await initBlockchain();
        await createTokens();
        await initNativeSwap();
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        disposeTokens();
        Blockchain.dispose();
    });

    await vm.it('', async () => {
        await tokenArray[0].logToConsole();

        const intialProvider: ProviderInfo = await createPool(
            tokenArray[0],
            expandNumberTo18Decimals(10000000),
            expandNumberTo18Decimals(10),
        );

        await intialProvider.logToConsole();

        await tokenArray[0].logToConsole();
    });
});
