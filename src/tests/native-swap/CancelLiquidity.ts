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

import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';

import {
    helper_createPool,
    helper_listLiquidity,
    helper_reserve,
    helper_swap,
} from '../utils/OperationHelper.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('NativeSwap: Priority and Normal Queue cancelliquidity', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

    const userAddress: Address = receiver;
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    const liquidityOwner: Address = Blockchain.generateRandomAddress();

    const initialLiquidityAmount: number = 1_000_000;
    const initialLiquidityAmountExpanded: bigint =
        Blockchain.expandTo18Decimals(initialLiquidityAmount);
    const floorPrice: bigint = 100000000000000n;

    async function listToken(
        amountIn: number,
        priority: boolean,
        providerAddress: Address,
    ): Promise<void> {
        const realAmountIn = Blockchain.expandTo18Decimals(amountIn);
        await token.mintRaw(providerAddress, realAmountIn);
        await token.increaseAllowance(providerAddress, nativeSwap.address, realAmountIn);

        await helper_listLiquidity(
            nativeSwap,
            tokenAddress,
            providerAddress,
            realAmountIn,
            priority,
            providerAddress,
            false,
            false,
        );
    }

    async function reserve(satIn: bigint): Promise<void> {
        await helper_reserve(
            nativeSwap,
            tokenAddress,
            Blockchain.msgSender,
            satIn,
            1n,
            false,
            false,
            true,
        );
    }

    async function reserveSwap(satIn: bigint): Promise<void> {
        await reserve(satIn);
        Blockchain.blockNumber += 3n;
        await helper_swap(nativeSwap, tokenAddress, Blockchain.msgSender, false);
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

        await helper_createPool(
            nativeSwap,
            token,
            liquidityOwner,
            liquidityOwner,
            initialLiquidityAmount,
            floorPrice,
            initialLiquidityAmountExpanded,
            40,
            false,
            true,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to cancel liquidity when no liquidity listed', async () => {
        Blockchain.blockNumber = 1000n;
        const provider = Blockchain.generateRandomAddress();
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: tokenAddress,
            });
        }).toThrow('NATIVE_SWAP: Provider is not listed.');
    });

    await vm.it(
        'should fail to cancel liquidity when provider liquidity has been consumed',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2n;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await reserveSwap(100000000000n);

            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;
                Blockchain.msgSender = provider;
                Blockchain.txOrigin = provider;
                await nativeSwap.cancelListing({
                    token: tokenAddress,
                });
            }).toThrow('NATIVE_SWAP: Provider is not listed.');
        },
    );

    await vm.it(
        'should fail to cancel liquidity when provider has active reservation',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2n;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await reserve(10000n);

            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;
                Blockchain.msgSender = provider;
                Blockchain.txOrigin = provider;
                await nativeSwap.cancelListing({
                    token: tokenAddress,
                });
            }).toThrow(
                'NATIVE_SWAP: You can no longer cancel this listing. Someone have active reservations on your liquidity.',
            );
        },
    );

    await vm.it(
        'should fail to cancel liquidity when provider is providing liquidity',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2n;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await reserveSwap(10000n);

            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;
                Blockchain.msgSender = provider;
                Blockchain.txOrigin = provider;
                await nativeSwap.cancelListing({
                    token: tokenAddress,
                });
            }).toThrow(
                'NATIVE_SWAP: You can no longer cancel this listing. Provider is providing liquidity.',
            );
        },
    );

    await vm.it('should fail to cancel liquidity when provider is purged', async () => {
        Blockchain.blockNumber = 1000n;
        const provider = Blockchain.generateRandomAddress();
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await listToken(10000, false, provider);

        Blockchain.blockNumber += 2n;
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;
        await reserve(10000n);

        Blockchain.blockNumber += 12n;
        Blockchain.msgSender = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = Blockchain.msgSender;
        await listToken(10000, false, Blockchain.msgSender);

        await Assert.expect(async () => {
            Blockchain.blockNumber += 1n;
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await nativeSwap.cancelListing({
                token: tokenAddress,
            });
        }).toThrow(
            'NATIVE_SWAP: You cannot cancel this listing at the moment. Provider is in the purge queue and needs to be purged first.',
        );
    });

    await vm.it(
        'should fail to cancel liquidity when provider is initial liquidity provider',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2n;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await reserve(10000n);

            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;
                Blockchain.msgSender = liquidityOwner;
                Blockchain.txOrigin = liquidityOwner;
                await nativeSwap.cancelListing({
                    token: tokenAddress,
                });
            }).toThrow('NATIVE_SWAP: Initial provider cannot cancel listing.');
        },
    );

    await vm.it(
        'should apply penalty, refund provider and update balance when cancellisting within a small time frame',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 1n;
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            const result = await nativeSwap.cancelListing({
                token: tokenAddress,
            });

            const cancelEvts = result.response.events.filter((e) => e.type === 'ListingCanceled');
            const transferEvts = result.response.events.filter((e) => e.type === 'Transfer');

            Assert.expect(cancelEvts.length).toEqual(1);
            Assert.expect(transferEvts.length).toEqual(2);

            const cancelEvt = NativeSwapTypesCoders.decodeCancelListingEvent(cancelEvts[0].data);
            Assert.expect(cancelEvt.penalty).toEqual(5000000000000000000000n);

            const transferEvt1 = NativeSwapTypesCoders.decodeTransferEvent(transferEvts[0].data);
            const transferEvt2 = NativeSwapTypesCoders.decodeTransferEvent(transferEvts[1].data);

            Assert.expect(transferEvt1.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvt1.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEvt1.amount).toEqual(cancelEvt.amount - cancelEvt.penalty);

            Assert.expect(transferEvt2.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvt2.to.toString()).toEqual(stakingContractAddress.toString());
            Assert.expect(transferEvt2.amount).toEqual(cancelEvt.penalty);

            const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });
            Assert.expect(providerDetail.isActive).toEqual(false);
            Assert.expect(providerDetail.liquidity).toEqual(0n);
        },
    );

    await vm.it(
        'should apply penalty, refund provider and update balance when cancellisting with max penalty',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2020n;
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            const result = await nativeSwap.cancelListing({
                token: tokenAddress,
            });

            const cancelEvts = result.response.events.filter((e) => e.type === 'ListingCanceled');
            const transferEvts = result.response.events.filter((e) => e.type === 'Transfer');

            Assert.expect(cancelEvts.length).toEqual(1);
            Assert.expect(transferEvts.length).toEqual(2);

            const cancelEvt = NativeSwapTypesCoders.decodeCancelListingEvent(cancelEvts[0].data);
            Assert.expect(cancelEvt.penalty).toEqual(9000000000000000000000n);

            const transferEvt1 = NativeSwapTypesCoders.decodeTransferEvent(transferEvts[0].data);
            const transferEvt2 = NativeSwapTypesCoders.decodeTransferEvent(transferEvts[1].data);

            Assert.expect(transferEvt1.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvt1.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEvt1.amount).toEqual(cancelEvt.amount - cancelEvt.penalty);

            Assert.expect(transferEvt2.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvt2.to.toString()).toEqual(stakingContractAddress.toString());
            Assert.expect(transferEvt2.amount).toEqual(cancelEvt.penalty);

            const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });
            Assert.expect(providerDetail.isActive).toEqual(false);
            Assert.expect(providerDetail.liquidity).toEqual(0n);
        },
    );

    await vm.it(
        'should apply penalty, refund provider and update balance when cancellisting with ramp up',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 10n;
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            const result = await nativeSwap.cancelListing({
                token: tokenAddress,
            });

            const cancelEvts = result.response.events.filter((e) => e.type === 'ListingCanceled');
            const transferEvts = result.response.events.filter((e) => e.type === 'Transfer');

            Assert.expect(cancelEvts.length).toEqual(1);
            Assert.expect(transferEvts.length).toEqual(2);

            const cancelEvt = NativeSwapTypesCoders.decodeCancelListingEvent(cancelEvts[0].data);
            Assert.expect(cancelEvt.penalty).toEqual(5011000000000000000000n);

            const transferEvt1 = NativeSwapTypesCoders.decodeTransferEvent(transferEvts[0].data);
            const transferEvt2 = NativeSwapTypesCoders.decodeTransferEvent(transferEvts[1].data);

            Assert.expect(transferEvt1.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvt1.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEvt1.amount).toEqual(cancelEvt.amount - cancelEvt.penalty);

            Assert.expect(transferEvt2.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvt2.to.toString()).toEqual(stakingContractAddress.toString());
            Assert.expect(transferEvt2.amount).toEqual(cancelEvt.penalty);

            const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });
            Assert.expect(providerDetail.isActive).toEqual(false);
            Assert.expect(providerDetail.liquidity).toEqual(0n);
        },
    );

    await vm.it('should fail to cancel liquidity if invalid token address', async () => {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: new Address(),
            });
        }).toThrow(`Invalid token address`);

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: Address.dead(),
            });
        }).toThrow(`Invalid token address`);
    });

    await vm.it('should fail to cancel liquidity if no pool created', async () => {
        nativeSwap.dispose();
        token.dispose();
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
        await token.mint(userAddress, 10_000_000);

        nativeSwap = new NativeSwap(liquidityOwner, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        const amount = 100000n;
        await token.increaseAllowance(userAddress, nativeSwap.address, 100000n);

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: tokenAddress,
            });
        }).toThrow('NATIVE_SWAP: Pool does not exist for token.');
    });
});
