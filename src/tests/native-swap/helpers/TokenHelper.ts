import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20 } from '@btc-vision/unit-test-framework';
import { ProviderHelper } from './ProviderHelper.js';

export class TokenHelper {
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

    public async getBalanceOf(address: Address): Promise<bigint> {
        return await this.token.balanceOf(address);
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

export async function assertProviderBalanceHelper(
    provider: ProviderHelper,
    value: bigint,
): Promise<void> {
    const newProviderBalance: bigint = await provider.getBalance();
    Assert.expect(newProviderBalance).toEqual(value);
}

export async function assertNativeSwapBalanceHelper(
    tokenHelper: TokenHelper,
    value: bigint,
): Promise<void> {
    const nativeSwapBalance: bigint = await tokenHelper.getNativeSwapContractBalance();
    Assert.expect(nativeSwapBalance).toEqual(value);
}

export async function assertStakingBalanceHelper(
    tokenHelper: TokenHelper,
    value: bigint,
): Promise<void> {
    const stakingBalance: bigint = await tokenHelper.getStakingContractBalance();
    Assert.expect(stakingBalance).toEqual(value);
}
