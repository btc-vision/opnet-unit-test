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
    helper_getProviderDetails,
    helper_getReserve,
    helper_listLiquidity,
    helper_reserve,
    helper_swap,
} from '../utils/OperationHelper.js';

const receiver: Address = Blockchain.generateRandomAddress();

async function setupPool(
    nativeSwap: NativeSwap,
    token: OP20,
    liquidityOwner: Address,
): Promise<void> {
    const floorPrice: bigint = 100000000000000n;
    const initialLiquidityAmount: number = 1_000_000;
    const initialLiquidityAmountExpanded: bigint =
        Blockchain.expandTo18Decimals(initialLiquidityAmount);

    Blockchain.msgSender = liquidityOwner;
    Blockchain.txOrigin = liquidityOwner;
    const amountIn = Blockchain.expandTo18Decimals(500);
    await token.mint(liquidityOwner, 10_000_000);

    Blockchain.msgSender = liquidityOwner;
    Blockchain.txOrigin = liquidityOwner;
    await token.increaseAllowance(liquidityOwner, nativeSwap.address, amountIn * 2n);

    await helper_createPool(
        nativeSwap,
        token,
        liquidityOwner,
        liquidityOwner,
        initialLiquidityAmount,
        floorPrice,
        initialLiquidityAmountExpanded,
        100,
        false,
        true,
    );
}

async function listLiquidity(
    nativeSwap: NativeSwap,
    token: OP20,
    provider: Address,
    liquidityOwner: Address,
): Promise<void> {
    Blockchain.msgSender = liquidityOwner;
    Blockchain.txOrigin = liquidityOwner;
    const amountIn = Blockchain.expandTo18Decimals(500);
    await token.mint(provider, 10_000_000);

    Blockchain.msgSender = provider;
    Blockchain.txOrigin = provider;
    await token.increaseAllowance(provider, nativeSwap.address, amountIn * 2n);

    await helper_listLiquidity(
        nativeSwap,
        token.address,
        provider,
        amountIn,
        false,
        provider,
        false,
        false,
    );
}

await opnet('NativeSwap: withdraw mode', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;
    let tokenB: OP20;

    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const tokenBAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    const liquidityOwner: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
        Blockchain.msgSender = userAddress;

        token = new OP20({
            file: 'MyToken',
            deployer: liquidityOwner,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        tokenB = new OP20({
            file: 'MyToken',
            deployer: liquidityOwner,
            address: tokenBAddress,
            decimals: 18,
        });
        Blockchain.register(tokenB);
        await tokenB.init();

        // Give user some extra tokens beyond the initial liquidity
        // so that subsequent "addLiquidity(...)" calls can work
        await token.mint(userAddress, 10_000_000_000);
        await tokenB.mint(userAddress, 10_000_000_000);

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        const stackingContractAddress: Address = Blockchain.generateRandomAddress();
        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: stackingContractAddress,
        });
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        tokenB.dispose();
        Blockchain.dispose();
    });

    await vm.it(
        'should fail to activate withdraw mode if the caller is not the owner',
        async () => {
            Blockchain.blockNumber = 1000n;
            const randomOwner = Blockchain.generateRandomAddress();

            Blockchain.msgSender = randomOwner;
            Blockchain.txOrigin = randomOwner;

            await Assert.expect(async () => {
                await nativeSwap.activateWithdrawMode();
            }).toThrow();
        },
    );

    await vm.it('should activate withdraw mode if the caller is the owner', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        const currentActivateWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentActivateWithdrawMode.isWithdrawModeActive).toEqual(false);

        await nativeSwap.activateWithdrawMode();

        const newActivateWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(newActivateWithdrawMode.isWithdrawModeActive).toEqual(true);

        Blockchain.blockNumber = 1003n;
        Blockchain.msgSender = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = Blockchain.msgSender;
        const newActivateWithdrawMode2 = await nativeSwap.isWithdrawModeActive();
        Assert.expect(newActivateWithdrawMode2.isWithdrawModeActive).toEqual(true);
    });

    await vm.it(
        'should fail when calling activateWithdrawMode and already in withdraw mode',
        async () => {
            Blockchain.blockNumber = 1000n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            const currentActivateWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentActivateWithdrawMode.isWithdrawModeActive).toEqual(false);

            await nativeSwap.activateWithdrawMode();
            const newActivateWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(newActivateWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.blockNumber = 1003n;
            Blockchain.msgSender = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = Blockchain.msgSender;

            const newActivateWithdrawMode2 = await nativeSwap.isWithdrawModeActive();
            Assert.expect(newActivateWithdrawMode2.isWithdrawModeActive).toEqual(true);

            Blockchain.blockNumber = 1004n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await Assert.expect(async () => {
                await nativeSwap.activateWithdrawMode();
            }).toThrow();
        },
    );

    await vm.it(
        'should return true when calling isWithdrawModeActive and in withdraw mode',
        async () => {
            Blockchain.blockNumber = 1000n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            const currentActivateWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentActivateWithdrawMode.isWithdrawModeActive).toEqual(false);

            await nativeSwap.activateWithdrawMode();

            Blockchain.blockNumber = 1003n;
            Blockchain.msgSender = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = Blockchain.msgSender;

            const newActivateWithdrawMode2 = await nativeSwap.isWithdrawModeActive();
            Assert.expect(newActivateWithdrawMode2.isWithdrawModeActive).toEqual(true);
        },
    );

    await vm.it(
        'should return false when calling isWithdrawModeActive and not in withdraw mode',
        async () => {
            Blockchain.blockNumber = 1000n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            const currentActivateWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentActivateWithdrawMode.isWithdrawModeActive).toEqual(false);
        },
    );

    await vm.it('should fail to call reserve when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                randomOwner,
                100000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow();
    });

    await vm.it('should fail to call swap when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await helper_swap(nativeSwap, tokenAddress, randomOwner, false);
        }).toThrow();
    });

    await vm.it('should fail to call listLiquidity when when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await helper_listLiquidity(
                nativeSwap,
                tokenAddress,
                randomOwner,
                10000n,
                false,
                Blockchain.generateRandomAddress(),
                false,
                false,
            );
        }).toThrow();
    });

    await vm.it('should fail to call cancelListing when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: tokenAddress,
            });
        }).toThrow();
    });

    await vm.it('should fail to call createpool when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await helper_createPool(
                nativeSwap,
                token,
                liquidityOwner,
                liquidityOwner,
                100000000000000000,
                100000000n,
                100000000000000000000000n,
                40,
                false,
                true,
            );
        }).toThrow();
    });

    await vm.it('should fail to call setfees when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        await Assert.expect(async () => {
            await nativeSwap.setFees({ priorityQueueBaseFee: 1000n, reservationBaseFee: 1000n });
        }).toThrow();
    });

    await vm.it(
        'should fail to call setStakingContractAddress when withdraw mode is active',
        async () => {
            Blockchain.blockNumber = 1000n;

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            await Assert.expect(async () => {
                await nativeSwap.setStakingContractAddress({
                    stakingContractAddress: Blockchain.generateRandomAddress(),
                });
            }).toThrow();
        },
    );

    await vm.it('should fail to call setFeesAddress when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        await Assert.expect(async () => {
            await nativeSwap.setFeesAddress({
                feesAddress: 'random address',
            });
        }).toThrow();
    });

    await vm.it('should fail to call pause when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        await Assert.expect(async () => {
            await nativeSwap.pause();
        }).toThrow();
    });

    await vm.it('should fail to call unpause when withdraw mode is active', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        await Assert.expect(async () => {
            await nativeSwap.unpause();
        }).toThrow();
    });

    await vm.it(
        'should fail to call withdrawListing when withdraw mode is not active',
        async () => {
            Blockchain.blockNumber = 1000n;

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(false);

            await Assert.expect(async () => {
                await nativeSwap.withdrawListing({ token: tokenAddress });
            }).toThrow();
        },
    );

    await vm.it('should fail to call withdrawListing when no pool for token', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        await Assert.expect(async () => {
            await nativeSwap.withdrawListing({ token: Blockchain.generateRandomAddress() });
        }).toThrow();
    });

    await vm.it(
        'should fail to call withdrawListing when provider does not list any liquidity',
        async () => {
            Blockchain.blockNumber = 1000n;

            await setupPool(nativeSwap, token, liquidityOwner);

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.msgSender = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = Blockchain.msgSender;

            await Assert.expect(async () => {
                await nativeSwap.withdrawListing({ token: tokenAddress });
            }).toThrow();
        },
    );

    await vm.it(
        'should fail to call withdrawListing when provider has liquidity at some point in time, but does not have anymore',
        async () => {
            // Create a pool
            Blockchain.blockNumber = 1000n;
            await setupPool(nativeSwap, token, liquidityOwner);

            // List liquidity
            Blockchain.blockNumber = 1002n;
            const provider = Blockchain.generateRandomAddress();
            await listLiquidity(nativeSwap, token, provider, liquidityOwner);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            const getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            // Reserve
            Blockchain.blockNumber = 1004n;
            const reserveAddress = Blockchain.generateRandomAddress();
            const reserveResult = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                2951990n,
                0n,
                false,
                false,
                true,
                0,
            );
            Assert.expect(reserveResult.expectedAmountOut).toEqual(499999868752406850000n);
            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reserveResult.response.events,
            );

            Assert.expect(decodedReservation.recipients.length).toEqual(1);
            Assert.expect(decodedReservation.recipients[0].address).toEqual(
                provider.p2tr(Blockchain.network),
            );
            Assert.expect(decodedReservation.recipients[0].amount).toEqual(2952342n);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            const getProviderDetailsResult2 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult2.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult2.reserved).toEqual(499999868752406850000n);

            // Swap
            Blockchain.blockNumber = 1007n;

            await helper_swap(nativeSwap, tokenAddress, reserveAddress, false);

            const getProviderDetailsResult3 = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult3.liquidity).toEqual(0n);

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;

            await Assert.expect(async () => {
                await nativeSwap.withdrawListing({ token: tokenAddress });
            }).toThrow();
        },
    );

    await vm.it(
        'should fail to call withdrawListing when provider has token A with liquidity and token B with no liquidity and trying to withdraw token B',
        async () => {
            // Create a pool
            Blockchain.blockNumber = 1000n;
            await setupPool(nativeSwap, token, liquidityOwner);
            await setupPool(nativeSwap, tokenB, liquidityOwner);

            // List liquidity
            Blockchain.blockNumber = 1002n;
            const provider = Blockchain.generateRandomAddress();
            await listLiquidity(nativeSwap, token, provider, liquidityOwner);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            let getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenB.address,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;

            await Assert.expect(async () => {
                await nativeSwap.withdrawListing({ token: tokenB.address });
            }).toThrow();
        },
    );

    await vm.it(
        'should allow to call withdrawListing 1 time when provider has liquidity and then fail when trying to withdraw after',
        async () => {
            // Create a pool
            Blockchain.blockNumber = 1000n;
            await setupPool(nativeSwap, token, liquidityOwner);

            // List liquidity
            Blockchain.blockNumber = 1002n;
            const provider = Blockchain.generateRandomAddress();
            await listLiquidity(nativeSwap, token, provider, liquidityOwner);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            let getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            Blockchain.blockNumber = 1005n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;

            const withdrawResult = await nativeSwap.withdrawListing({ token: tokenAddress });

            Assert.expect(withdrawResult.response.events.length).toEqual(2);
            const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
                withdrawResult.response.events[0].data,
            );

            const withdrawEvent = NativeSwapTypesCoders.decodeWithdrawListingEvent(
                withdrawResult.response.events[1].data,
            );

            Assert.expect(transferEvent.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvent.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEvent.amount).toEqual(500000000000000000000n);

            Assert.expect(withdrawEvent.providerAddress.toString()).toEqual(provider.toString());
            Assert.expect(withdrawEvent.tokenAddress.toString()).toEqual(token.address.toString());
            Assert.expect(withdrawEvent.amount).toEqual(500000000000000000000n);
            Assert.expect(withdrawEvent.amount).toEqual(transferEvent.amount);

            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                token.address,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);
            Assert.expect(getProviderDetailsResult.isActive).toEqual(false);

            await Assert.expect(async () => {
                await nativeSwap.withdrawListing({ token: tokenAddress });
            }).toThrow();

            Blockchain.blockNumber = 1007n;
            await Assert.expect(async () => {
                await nativeSwap.withdrawListing({ token: tokenAddress });
            }).toThrow();
        },
    );

    await vm.it(
        'should withdrawListing for multiple tokens when provider has liquidity for each token',
        async () => {
            // Create a pool
            Blockchain.blockNumber = 1000n;
            await setupPool(nativeSwap, token, liquidityOwner);
            await setupPool(nativeSwap, tokenB, liquidityOwner);

            // List liquidity token A
            Blockchain.blockNumber = 1002n;
            const provider = Blockchain.generateRandomAddress();
            await listLiquidity(nativeSwap, token, provider, liquidityOwner);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            let getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            // List liquidity token B
            Blockchain.blockNumber = 1004n;
            await listLiquidity(nativeSwap, tokenB, provider, liquidityOwner);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenBAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            Blockchain.blockNumber = 1015n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.blockNumber = 1020n;
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;

            // Withdraw token A
            const withdrawResultA = await nativeSwap.withdrawListing({ token: tokenAddress });

            Assert.expect(withdrawResultA.response.events.length).toEqual(2);
            const transferEventA = NativeSwapTypesCoders.decodeTransferEvent(
                withdrawResultA.response.events[0].data,
            );

            const withdrawEventA = NativeSwapTypesCoders.decodeWithdrawListingEvent(
                withdrawResultA.response.events[1].data,
            );

            Assert.expect(transferEventA.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEventA.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEventA.amount).toEqual(500000000000000000000n);

            Assert.expect(withdrawEventA.providerAddress.toString()).toEqual(provider.toString());
            Assert.expect(withdrawEventA.tokenAddress.toString()).toEqual(token.address.toString());
            Assert.expect(withdrawEventA.amount).toEqual(500000000000000000000n);
            Assert.expect(withdrawEventA.amount).toEqual(transferEventA.amount);

            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            // Withdraw token B
            const withdrawResultB = await nativeSwap.withdrawListing({ token: tokenBAddress });

            Assert.expect(withdrawResultB.response.events.length).toEqual(2);
            const transferEventB = NativeSwapTypesCoders.decodeTransferEvent(
                withdrawResultB.response.events[0].data,
            );

            const withdrawEventB = NativeSwapTypesCoders.decodeWithdrawListingEvent(
                withdrawResultB.response.events[1].data,
            );

            Assert.expect(transferEventB.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEventB.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEventB.amount).toEqual(500000000000000000000n);

            Assert.expect(withdrawEventB.providerAddress.toString()).toEqual(provider.toString());
            Assert.expect(withdrawEventB.tokenAddress.toString()).toEqual(
                tokenB.address.toString(),
            );
            Assert.expect(withdrawEventB.amount).toEqual(500000000000000000000n);
            Assert.expect(withdrawEventB.amount).toEqual(transferEventB.amount);

            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenBAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);
        },
    );

    await vm.it('should reset provider after withdrawListing', async () => {
        // Create a pool
        Blockchain.blockNumber = 1000n;
        await setupPool(nativeSwap, token, liquidityOwner);

        // List liquidity token A
        Blockchain.blockNumber = 1002n;
        const provider = Blockchain.generateRandomAddress();
        await listLiquidity(nativeSwap, token, provider, liquidityOwner);

        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        let getProviderDetailsResult = await helper_getProviderDetails(
            nativeSwap,
            tokenAddress,
            false,
        );

        Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
        Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

        Blockchain.blockNumber = 1015n;
        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        Blockchain.blockNumber = 1020n;
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;

        // Withdraw token
        const withdrawResultA = await nativeSwap.withdrawListing({ token: tokenAddress });

        getProviderDetailsResult = await helper_getProviderDetails(nativeSwap, tokenAddress, false);

        Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);
        Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);
        Assert.expect(getProviderDetailsResult.isActive).toEqual(false);
        Assert.expect(getProviderDetailsResult.listedTokenAt).toEqual(18446744073709551615n);
        Assert.expect(getProviderDetailsResult.purgeIndex).toEqual(4294967295);
        Assert.expect(getProviderDetailsResult.queueIndex).toEqual(4294967295);
        Assert.expect(getProviderDetailsResult.isPriority).toEqual(false);
        Assert.expect(getProviderDetailsResult.isPurged).toEqual(false);
    });

    await vm.it('should allow to call withdrawListing for initial provider', async () => {
        // Create a pool
        Blockchain.blockNumber = 1000n;
        await setupPool(nativeSwap, token, liquidityOwner);

        Blockchain.msgSender = liquidityOwner;
        Blockchain.txOrigin = liquidityOwner;
        let getProviderDetailsResult = await helper_getProviderDetails(
            nativeSwap,
            tokenAddress,
            false,
        );

        Assert.expect(getProviderDetailsResult.liquidity).toEqual(1000000000000000000000000n);
        Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

        Blockchain.blockNumber = 1005n;
        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.activateWithdrawMode();
        const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
        Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

        Blockchain.msgSender = liquidityOwner;
        Blockchain.txOrigin = liquidityOwner;

        const withdrawResult = await nativeSwap.withdrawListing({ token: tokenAddress });

        Assert.expect(withdrawResult.response.events.length).toEqual(2);
        const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
            withdrawResult.response.events[0].data,
        );

        const withdrawEvent = NativeSwapTypesCoders.decodeWithdrawListingEvent(
            withdrawResult.response.events[1].data,
        );

        Assert.expect(transferEvent.from.toString()).toEqual(nativeSwapAddress.toString());
        Assert.expect(transferEvent.to.toString()).toEqual(liquidityOwner.toString());
        Assert.expect(transferEvent.amount).toEqual(1000000000000000000000000n);

        Assert.expect(withdrawEvent.providerAddress.toString()).toEqual(liquidityOwner.toString());
        Assert.expect(withdrawEvent.tokenAddress.toString()).toEqual(token.address.toString());
        Assert.expect(withdrawEvent.amount).toEqual(1000000000000000000000000n);
        Assert.expect(withdrawEvent.amount).toEqual(transferEvent.amount);

        getProviderDetailsResult = await helper_getProviderDetails(
            nativeSwap,
            token.address,
            false,
        );

        Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);
        Assert.expect(getProviderDetailsResult.isActive).toEqual(false);
    });

    await vm.it(
        'should allow to call withdrawListing when provider has liquidity and reserved amount',
        async () => {
            // Create a pool
            Blockchain.blockNumber = 1000n;
            await setupPool(nativeSwap, token, liquidityOwner);

            // List liquidity
            Blockchain.blockNumber = 1002n;
            const provider = Blockchain.generateRandomAddress();
            await listLiquidity(nativeSwap, token, provider, liquidityOwner);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            let getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                tokenAddress,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(500000000000000000000n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);

            // Reserve
            Blockchain.blockNumber = 1004n;
            const reserveAddress = Blockchain.generateRandomAddress();
            const reserveResult = await helper_reserve(
                nativeSwap,
                tokenAddress,
                reserveAddress,
                255555n,
                0n,
                false,
                false,
                true,
                0,
            );
            Assert.expect(reserveResult.expectedAmountOut).toEqual(43280035463039625000n);

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                reserveResult.response.events,
            );

            Assert.expect(decodedReservation.recipients.length).toEqual(1);
            Assert.expect(decodedReservation.recipients[0].address).toEqual(
                provider.p2tr(Blockchain.network),
            );
            Assert.expect(decodedReservation.recipients[0].amount).toEqual(255555n);

            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                token.address,
                false,
            );

            Assert.expect(getProviderDetailsResult.reserved).toBeGreaterThan(0n);

            Blockchain.blockNumber = 1005n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.activateWithdrawMode();
            const currentWithdrawMode = await nativeSwap.isWithdrawModeActive();
            Assert.expect(currentWithdrawMode.isWithdrawModeActive).toEqual(true);

            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;

            const withdrawResult = await nativeSwap.withdrawListing({ token: tokenAddress });

            Assert.expect(withdrawResult.response.events.length).toEqual(2);
            const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
                withdrawResult.response.events[0].data,
            );

            const withdrawEvent = NativeSwapTypesCoders.decodeWithdrawListingEvent(
                withdrawResult.response.events[1].data,
            );

            Assert.expect(transferEvent.from.toString()).toEqual(nativeSwapAddress.toString());
            Assert.expect(transferEvent.to.toString()).toEqual(provider.toString());
            Assert.expect(transferEvent.amount).toEqual(500000000000000000000n);

            Assert.expect(withdrawEvent.providerAddress.toString()).toEqual(provider.toString());
            Assert.expect(withdrawEvent.tokenAddress.toString()).toEqual(token.address.toString());
            Assert.expect(withdrawEvent.amount).toEqual(500000000000000000000n);
            Assert.expect(withdrawEvent.amount).toEqual(transferEvent.amount);

            getProviderDetailsResult = await helper_getProviderDetails(
                nativeSwap,
                token.address,
                false,
            );

            Assert.expect(getProviderDetailsResult.liquidity).toEqual(0n);
            Assert.expect(getProviderDetailsResult.reserved).toEqual(0n);
        },
    );
});
