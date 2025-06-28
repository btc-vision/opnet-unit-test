import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    gas2BTC,
    gas2Sat,
    gas2USD,
    generateEmptyTransaction,
    OP20,
    opnet,
    OPNetUnit,
    Transaction,
} from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { networks } from '@btc-vision/bitcoin';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { logLiquidityListedEvent, logTransferEvent } from '../utils/LoggerHelper.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('NativeSwap: createPool', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

    const userAddress: Address = receiver;
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    const liquidityOwner: Address = Blockchain.generateRandomAddress();
    const initialLiquidityAddress: string = liquidityOwner.p2tr(Blockchain.network);
    const initialLiquidityAmount: bigint = Blockchain.expandTo18Decimals(1_000_000);

    async function mintAndApprove(amount: bigint, to: Address): Promise<void> {
        const addyBefore = Blockchain.msgSender;

        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await token.mintRaw(to, amount);

        Blockchain.txOrigin = addyBefore;
        Blockchain.msgSender = addyBefore;

        await token.increaseAllowance(addyBefore, nativeSwap.address, amount);
    }

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP20({
            file: 'MyToken',
            deployer: liquidityOwner,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        // Give user some extra tokens beyond the initial liquidity
        // so that subsequent "addLiquidity(...)" calls can work
        await token.mint(userAddress, 10_000_000);

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to create a pool if the creator is not the token owner', async () => {
        Blockchain.blockNumber = 1000n;
        const randomOwner = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 100000000000000n,
                initialLiquidity: initialLiquidityAmount,
                receiver: initialLiquidityAddress,
                antiBotEnabledFor: 0,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 40,
            });
        }).toThrow('NATIVE_SWAP: Only token owner can call createPool.');
    });

    await vm.it('should fail to create a pool if the receiver address is invalid', async () => {
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 100000000000000n,
                initialLiquidity: initialLiquidityAmount,
                receiver: liquidityOwner.p2tr(networks.bitcoin),
                antiBotEnabledFor: 0,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 40,
            });
        }).toThrow('NATIVE_SWAP: Invalid receiver address.');
    });

    await vm.it('should fail to create a pool if the floor price is 0', async () => {
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 0n,
                initialLiquidity: initialLiquidityAmount,
                receiver: initialLiquidityAddress,
                antiBotEnabledFor: 0,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 40,
            });
        }).toThrow('NATIVE_SWAP: Floor price cannot be zero.');
    });

    await vm.it('should fail to create a pool if the initial liquidity is 0', async () => {
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 100000000000000n,
                initialLiquidity: 0n,
                receiver: initialLiquidityAddress,
                antiBotEnabledFor: 0,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 40,
            });
        }).toThrow('NATIVE_SWAP: Initial liquidity cannot be zero.');
    });

    await vm.it(
        'should fail to create a pool if the liquidity owner does not approve enough tokens',
        async () => {
            Blockchain.blockNumber = 1000n;
            Blockchain.txOrigin = liquidityOwner;
            Blockchain.msgSender = liquidityOwner;

            await mintAndApprove(initialLiquidityAmount - 10n, liquidityOwner);

            await Assert.expect(async () => {
                await nativeSwap.createPool({
                    token: tokenAddress,
                    floorPrice: 100000000000000n,
                    initialLiquidity: initialLiquidityAmount,
                    receiver: initialLiquidityAddress,
                    antiBotEnabledFor: 0,
                    antiBotMaximumTokensPerReservation: 0n,
                    maxReservesIn5BlocksPercent: 40,
                });
            }).toThrow('Insufficient allowance');
        },
    );

    await vm.it('should fail to create a pool if the antibot settings are invalid', async () => {
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 100000000000000n,
                initialLiquidity: initialLiquidityAmount,
                receiver: initialLiquidityAddress,
                antiBotEnabledFor: 5,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 40,
            });
        }).toThrow('NATIVE_SWAP: Anti-bot max tokens per reservation cannot be zero.');
    });

    await vm.it('should fail to create a pool if the pool already exists', async () => {
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: 100000000000000n,
            initialLiquidity: initialLiquidityAmount,
            receiver: initialLiquidityAddress,
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 40,
        });

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 100000000000000n,
                initialLiquidity: initialLiquidityAmount,
                receiver: initialLiquidityAddress,
                antiBotEnabledFor: 0,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 40,
            });
        }).toThrow('NATIVE_SWAP: Base quote already set.');
    });

    await vm.it(
        'should fail to create a pool if the maximum reservation percentage is out of range',
        async () => {
            Blockchain.blockNumber = 1000n;
            Blockchain.txOrigin = liquidityOwner;
            Blockchain.msgSender = liquidityOwner;

            await mintAndApprove(initialLiquidityAmount, liquidityOwner);

            await Assert.expect(async () => {
                await nativeSwap.createPool({
                    token: tokenAddress,
                    floorPrice: 100000000000000n,
                    initialLiquidity: initialLiquidityAmount,
                    receiver: initialLiquidityAddress,
                    antiBotEnabledFor: 0,
                    antiBotMaximumTokensPerReservation: 0n,
                    maxReservesIn5BlocksPercent: 101,
                });
            }).toThrow(
                'NATIVE_SWAP: The maximum reservation percentage for 5 blocks must be less than or equal to 100.',
            );
        },
    );

    await vm.it('should create a pool', async () => {
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidityAmount, liquidityOwner);

        const result = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: 100000000000000n,
            initialLiquidity: initialLiquidityAmount,
            receiver: initialLiquidityAddress,
            antiBotEnabledFor: 5,
            antiBotMaximumTokensPerReservation: 10000n,
            maxReservesIn5BlocksPercent: 80,
        });

        Assert.expect(result.response.events.length).toEqual(2);

        const transferEvt = NativeSwapTypesCoders.decodeTransferEvent(
            result.response.events[0].data,
        );

        const liquidityListedEvt = NativeSwapTypesCoders.decodeLiquidityListedEvent(
            result.response.events[1].data,
        );

        Assert.expect(transferEvt.from.toString()).toEqual(liquidityOwner.toString());
        Assert.expect(transferEvt.to.toString()).toEqual(nativeSwapAddress.toString());
        Assert.expect(transferEvt.amount).toEqual(initialLiquidityAmount);

        Assert.expect(liquidityListedEvt.totalLiquidity).toEqual(initialLiquidityAmount);
        Assert.expect(liquidityListedEvt.provider).toEqual(initialLiquidityAddress);

        const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });

        Assert.expect(providerDetail.queueIndex).toEqual(4294967294);
        Assert.expect(providerDetail.isActive).toEqual(true);

        const antibotSettings = await nativeSwap.getAntibotSettings({ token: tokenAddress });
        Assert.expect(antibotSettings.antiBotExpirationBlock).toEqual(1005n);
        Assert.expect(antibotSettings.maxTokensPerReservation).toEqual(10000n);
    });
});
