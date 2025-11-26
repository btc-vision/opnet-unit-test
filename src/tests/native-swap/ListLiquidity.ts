import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { ListLiquidityResult } from '../../contracts/NativeSwapTypes.js';
import { helper_createPool, helper_reserve, helper_swap } from '../utils/OperationHelper.js';
import { CSV_DURATION } from '../globals.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('NativeSwap: Priority and Normal Queue listLiquidity', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

    const userAddress: Address = receiver;
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    const liquidityOwner: Address = Blockchain.generateRandomAddress();
    const floorPrice: bigint = 100000000000000n;
    const initialLiquidityAmount: number = 1_000_000;
    const initialLiquidityAmountExpanded: bigint =
        Blockchain.expandTo18Decimals(initialLiquidityAmount);

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

        Blockchain.blockNumber = 100n;

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

    await vm.it(
        'should fail to add liquidity to the priority queue when not enough priority fees sent',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn);

            await Assert.expect(async () => {
                await nativeSwap.listLiquidity({
                    token: tokenAddress,
                    receiver: userAddress,
                    network: Blockchain.network,
                    amountIn: amountIn,
                    priority: true,
                    disablePriorityQueueFees: true,
                });
            }).toThrow('NATIVE_SWAP: Not enough fees for priority queue.');
        },
    );

    await vm.it('should fail to add liquidity with zero amount', async () => {
        await token.increaseAllowance(userAddress, nativeSwap.address, 0n);
        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: 0n,
                network: Blockchain.network,
                priority: false,
                disablePriorityQueueFees: false,
            });
        }).toThrow('NATIVE_SWAP: Amount in cannot be zero.');
    });

    await vm.it(
        'should fail to add liquidity when trying to add more liquidity than supported',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn);

            await Assert.expect(async () => {
                await nativeSwap.listLiquidity({
                    token: tokenAddress,
                    receiver: userAddress,
                    network: Blockchain.network,
                    amountIn: 340282366920938463463374607431768211455n,
                    priority: false,
                    disablePriorityQueueFees: false,
                });
            }).toThrow('NATIVE_SWAP: Liquidity overflow. Please add a smaller amount.');
        },
    );

    await vm.it(
        'should fail to  add to normal queue liquidity if provider is already priority',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(100);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn * 2n);

            // Add to priority first
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                network: Blockchain.network,
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
            });

            // Try adding to normal queue
            await Assert.expect(async () => {
                await nativeSwap.listLiquidity({
                    token: tokenAddress,
                    receiver: userAddress,
                    amountIn: amountIn,
                    priority: false,
                    network: Blockchain.network,
                    disablePriorityQueueFees: false,
                });
            }).toThrow(
                'NATIVE_SWAP: You already have an active position in the priority queue. Please use the priority queue.',
            );
        },
    );

    await vm.it('should fail to add liquidity when provider is providing liquidity', async () => {
        const amountIn = Blockchain.expandTo18Decimals(100);
        await token.increaseAllowance(userAddress, nativeSwap.address, amountIn * 2n);

        // Add to priority
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: userAddress,
            amountIn: amountIn,
            priority: true,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        Blockchain.blockNumber += 2n;
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;
        await reserveSwap(10000n);

        await Assert.expect(async () => {
            Blockchain.blockNumber += 1n;
            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;
            // Add to priority
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow(
            'NATIVE_SWAP: You have an active position partially fulfilled. You must wait until it is fully fulfilled.',
        );
    });

    await vm.it('should fail to add liquidity when provider have active reservation', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);
        // Setup a single provider with normal liquidity
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn * 2n);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.increaseAllowance(provider, nativeSwap.address, amountIn * 2n);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        // Make a reservation from a different user
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const satIn = 10000n;
        const minOut = 1n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
        });

        const decodedReservation2 = NativeSwapTypesCoders.decodeReservationEvents(
            reservation.response.events,
        );

        createRecipientUTXOs(decodedReservation2.recipients);
        Blockchain.blockNumber = Blockchain.blockNumber + 2n;

        await nativeSwap.swap({
            token: tokenAddress,
        });

        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: provider,
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow(
            'NATIVE_SWAP: You have an active position partially fulfilled. You must wait until it is fully fulfilled.',
        );
    });

    await vm.it('should fail to add liquidity when provider is purged', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn * 10n);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.increaseAllowance(provider, nativeSwap.address, amountIn * 10n);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        Blockchain.blockNumber += 2n;
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;
        await reserve(10000n);

        await Assert.expect(async () => {
            Blockchain.blockNumber += 12n;
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;

            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: provider,
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow(
            'NATIVE_SWAP: You are in the purge queue. Your current listing must be bought before listing again.',
        );
    });

    await vm.it('should fail to add liquidity if no quote is set', async () => {
        // Re-init a scenario with no call to createPool()
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP20({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();
        await token.mint(userAddress, 10_000_000);

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();
        Blockchain.msgSender = userAddress;

        const amountIn = Blockchain.expandTo18Decimals(100);
        await token.increaseAllowance(userAddress, nativeSwap.address, amountIn);

        // No createPool(...) invoked here => p0 = 0
        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow('NATIVE_SWAP: Pool does not exist for token.');
    });

    await vm.it(
        'should fail to add liquidity when provider is also initial liquidity provider',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(500);
            await token.mintRaw(liquidityOwner, amountIn * 2n);
            Blockchain.msgSender = liquidityOwner;
            Blockchain.txOrigin = liquidityOwner;
            await token.increaseAllowance(liquidityOwner, nativeSwap.address, amountIn * 2n);
            await Assert.expect(async () => {
                await nativeSwap.listLiquidity({
                    token: tokenAddress,
                    receiver: liquidityOwner,
                    amountIn: amountIn,
                    priority: false,
                    disablePriorityQueueFees: false,
                    network: Blockchain.network,
                });
            }).toThrow('NATIVE_SWAP: Initial provider can only add once, if not initialLiquidity.');
        },
    );

    await vm.it('should fail to add liquidity if liquidity in sat value is too low', async () => {
        // We want a huge floorPrice. So re-init an empty scenario and createPool with large p0
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

        await helper_createPool(
            nativeSwap,
            token,
            liquidityOwner,
            liquidityOwner,
            10_000_000,
            10000000000n,
            Blockchain.expandTo18Decimals(10_000_000),
            40,
            false,
            true,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // With that huge floor price, a smaller subsequent addition is worthless in sat terms:
        const smallAmount = 10n;
        await token.increaseAllowance(userAddress, nativeSwap.address, smallAmount);

        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: smallAmount,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow('NATIVE_SWAP: Liquidity value is too low in satoshis.');
    });

    await vm.it('should fail to add liquidity if no pool created', async () => {
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
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amount,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow('NATIVE_SWAP: Pool does not exist for token.');
    });

    await vm.it('should fail to add liquidity if the receiver address is invalid', async () => {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.blockNumber = 1000n;

        Blockchain.txOrigin = token.deployer;
        Blockchain.msgSender = token.deployer;

        const amountIn = Blockchain.expandTo18Decimals(500);
        await token.mintRaw(provider, amountIn);

        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await token.increaseAllowance(provider, nativeSwap.address, amountIn * 2n);

        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: provider,
                receiverStr: provider.p2tr(Blockchain.network),
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow('NATIVE_SWAP: Invalid receiver address.');
    });

    await vm.it('should fail to add liquidity if invalid token address', async () => {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.blockNumber = 1000n;
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: new Address(),
                receiver: provider,
                amountIn: 10000n,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow(`Invalid token address`);

        await Assert.expect(async () => {
            await nativeSwap.listLiquidity({
                token: Address.dead(),
                receiver: provider,
                amountIn: 10000n,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
        }).toThrow(`Invalid token address`);
    });

    await vm.it(
        'should not allow adding priority queue liquidity if provider is already normal',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(100);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn * 2n);

            // Add to normal first
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amountIn,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });

            // Try adding to priority queue
            await Assert.expect(async () => {
                await nativeSwap.listLiquidity({
                    token: tokenAddress,
                    receiver: userAddress,
                    amountIn: amountIn,
                    priority: true,
                    disablePriorityQueueFees: false,
                    network: Blockchain.network,
                });
            }).toThrow(
                'NATIVE_SWAP: Your current listing must be fully purchased before you can switch the queue type.',
            );
        },
    );

    await vm.it('should add liquidity to the normal queue successfully', async () => {
        Blockchain.blockNumber = 1000n;
        const amountIn = Blockchain.expandTo18Decimals(500);
        await token.increaseAllowance(userAddress, nativeSwap.address, amountIn);

        const reserveBefore = await nativeSwap.getReserve({ token: tokenAddress });

        const initialUserBalance = await token.balanceOf(userAddress);
        const initialContractBalance = await token.balanceOf(nativeSwap.address);

        const resp: ListLiquidityResult = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: userAddress,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        Assert.expect(resp.response.error).toBeUndefined();
        const finalUserBalance = await token.balanceOf(userAddress);
        const finalContractBalance = await token.balanceOf(nativeSwap.address);

        // Confirm tokens moved
        Assert.expect(finalUserBalance).toEqual(initialUserBalance - amountIn);
        Assert.expect(finalContractBalance).toEqual(initialContractBalance + amountIn);

        // Check events
        const events = resp.response.events;
        const LiquidityListedEvt = events.find((e) => e.type === 'LiquidityListed');
        if (!LiquidityListedEvt) {
            throw new Error('No LiquidityListed event found for normal queue');
        }

        const decoded = NativeSwapTypesCoders.decodeLiquidityListedEvent(LiquidityListedEvt.data);
        Assert.expect(decoded.totalLiquidity).toEqual(amountIn);
        Assert.expect(decoded.provider).toEqual(
            userAddress.toCSV(CSV_DURATION, Blockchain.network).address,
        );

        const reserveAfter = await nativeSwap.getReserve({ token: tokenAddress });

        // Check slashing
        Assert.expect(reserveAfter.virtualTokenReserve).toEqual(
            reserveBefore.virtualTokenReserve + amountIn / 2n,
        );

        const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });

        Assert.expect(providerDetail.listedTokenAt).toEqual(1000n);
    });

    await vm.it(
        'should add liquidity to the priority queue successfully and apply fee',
        async () => {
            Blockchain.blockNumber = 1000n;
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn);

            const reserveBefore = await nativeSwap.getReserve({ token: tokenAddress });
            const initialUserBalance = await token.balanceOf(userAddress);
            const initialContractBalance = await token.balanceOf(nativeSwap.address);
            const initialStakingBalance = await token.balanceOf(stakingContractAddress);

            // Priority mode: 3% fee to dead address by default logic
            const resp = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });

            Assert.expect(resp.response.error).toBeUndefined();

            const events = resp.response.events;
            const LiquidityListedEvt = events.find((e) => e.type === 'LiquidityListed');
            if (!LiquidityListedEvt) {
                throw new Error('No LiquidityListed event found for priority queue');
            }

            const feeAmount = (amountIn * 3n) / 100n;
            const decoded = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                LiquidityListedEvt.data,
            );

            Assert.expect(decoded.totalLiquidity).toEqual(amountIn - feeAmount);

            const reserveAfter = await nativeSwap.getReserve({ token: tokenAddress });
            const finalUserBalance = await token.balanceOf(userAddress);
            const finalContractBalance = await token.balanceOf(nativeSwap.address);
            const finalStakingBalance = await token.balanceOf(stakingContractAddress);

            Assert.expect(finalStakingBalance - initialStakingBalance).toEqual(feeAmount);
            Assert.expect(finalContractBalance - initialContractBalance).toEqual(
                amountIn - feeAmount,
            );
            Assert.expect(initialUserBalance - finalUserBalance).toEqual(amountIn);

            // Check slashing
            Assert.expect(reserveAfter.virtualTokenReserve).toEqual(
                reserveBefore.virtualTokenReserve + amountIn / 2n,
            );

            const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });

            Assert.expect(providerDetail.listedTokenAt).toEqual(1000n);
        },
    );

    await vm.it(
        'should add liquidity to the priority queue successfully, apply fee, and send priority fees to the correct address',
        async () => {
            const feesAddress = Blockchain.generateRandomAddress().p2tr(Blockchain.network);

            Blockchain.blockNumber = 999n;
            await nativeSwap.setFeesAddress({ feesAddress: feesAddress });

            Blockchain.blockNumber = 1000n;
            const amountIn = Blockchain.expandTo18Decimals(1000);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn);

            const reserveBefore = await nativeSwap.getReserve({ token: tokenAddress });
            const initialUserBalance = await token.balanceOf(userAddress);
            const initialContractBalance = await token.balanceOf(nativeSwap.address);
            const initialStakingBalance = await token.balanceOf(stakingContractAddress);

            // Priority mode: 3% fee to dead address by default logic
            const resp = await nativeSwap.listLiquidity(
                {
                    token: tokenAddress,
                    receiver: userAddress,
                    amountIn: amountIn,
                    priority: true,
                    disablePriorityQueueFees: false,
                    network: Blockchain.network,
                },
                feesAddress,
            );

            Assert.expect(resp.response.error).toBeUndefined();

            const events = resp.response.events;
            const LiquidityListedEvt = events.find((e) => e.type === 'LiquidityListed');
            if (!LiquidityListedEvt) {
                throw new Error('No LiquidityListed event found for priority queue');
            }

            const feeAmount = (amountIn * 3n) / 100n;
            const decoded = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                LiquidityListedEvt.data,
            );

            Assert.expect(decoded.totalLiquidity).toEqual(amountIn - feeAmount);

            const reserveAfter = await nativeSwap.getReserve({ token: tokenAddress });
            const finalUserBalance = await token.balanceOf(userAddress);
            const finalContractBalance = await token.balanceOf(nativeSwap.address);
            const finalStakingBalance = await token.balanceOf(stakingContractAddress);

            Assert.expect(finalStakingBalance - initialStakingBalance).toEqual(feeAmount);
            Assert.expect(finalContractBalance - initialContractBalance).toEqual(
                amountIn - feeAmount,
            );
            Assert.expect(initialUserBalance - finalUserBalance).toEqual(amountIn);

            // Check slashing
            Assert.expect(reserveAfter.virtualTokenReserve).toEqual(
                reserveBefore.virtualTokenReserve + amountIn / 2n,
            );

            const providerDetail = await nativeSwap.getProviderDetails({ token: tokenAddress });

            Assert.expect(providerDetail.listedTokenAt).toEqual(1000n);
        },
    );

    await vm.it(
        'should allow multiple additions to priority queue for the same provider',
        async () => {
            const amountIn = Blockchain.expandTo18Decimals(500);
            await token.increaseAllowance(userAddress, nativeSwap.address, amountIn * 2n);

            const reserve1 = await nativeSwap.getReserve({ token: tokenAddress });
            const initialStakingBalance = await token.balanceOf(stakingContractAddress);

            // First addition
            const resp1 = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });

            Assert.expect(resp1.response.error).toBeUndefined();

            const providerDetail1 = await nativeSwap.getProviderDetails({ token: tokenAddress });

            Blockchain.blockNumber++;

            // Second addition
            const resp2 = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amountIn,
                priority: true,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });

            Assert.expect(resp2.response.error).toBeUndefined();

            const providerDetail2 = await nativeSwap.getProviderDetails({ token: tokenAddress });
            const reserve2 = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            // Ensure queue index does not change when adding liquidity to existing
            Assert.expect(providerDetail2.queueIndex).toEqual(providerDetail1.queueIndex);

            const finalStakingBalance = await token.balanceOf(stakingContractAddress);

            // Check total liquidity (minus fee)
            const feeForEach = (amountIn * 3n) / 100n;
            const totalLiquidityExpected =
                (amountIn - feeForEach) * 2n + initialLiquidityAmountExpanded;

            Assert.expect(reserve2.liquidity).toEqual(totalLiquidityExpected);

            Assert.expect(finalStakingBalance - initialStakingBalance).toEqual(feeForEach * 2n);

            // Check slashing
            Assert.expect(reserve2.virtualTokenReserve).toEqual(
                reserve1.virtualTokenReserve + amountIn,
            );
        },
    );

    await vm.it('should change queue index when provider relist after being purged', async () => {
        Blockchain.blockNumber = 100n;
        const amountIn = Blockchain.expandTo18Decimals(500);

        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn * 2n);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.increaseAllowance(provider, nativeSwap.address, amountIn * 2n);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        const providerDetail1 = await nativeSwap.getProviderDetails({ token: tokenAddress });

        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const satIn = 100_000_000n;
        const minOut = 1n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
        });

        const decodedReservation2 = NativeSwapTypesCoders.decodeReservationEvents(
            reservation.response.events,
        );

        createRecipientUTXOs(decodedReservation2.recipients);
        Blockchain.blockNumber = Blockchain.blockNumber + 2n;

        await nativeSwap.swap({
            token: tokenAddress,
        });

        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        const providerDetail2 = await nativeSwap.getProviderDetails({ token: tokenAddress });

        Assert.expect(providerDetail1.queueIndex).toNotEqual(providerDetail2.queueIndex);
    });

    await vm.it('should handle multiple providers adding liquidity to both queues', async () => {
        const provider1 = Blockchain.generateRandomAddress();
        const provider2 = Blockchain.generateRandomAddress();

        const amt = Blockchain.expandTo18Decimals(1000);
        await token.mintRaw(provider1, amt * 2n);
        await token.mintRaw(provider2, amt * 2n);

        // Provider1: normal queue
        Blockchain.msgSender = provider1;
        Blockchain.txOrigin = provider1;
        await token.increaseAllowance(provider1, nativeSwap.address, amt);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider1,
            amountIn: amt,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        // Provider2: priority queue
        Blockchain.msgSender = provider2;
        Blockchain.txOrigin = provider2;
        await token.increaseAllowance(provider2, nativeSwap.address, amt);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider2,
            amountIn: amt,
            priority: true,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        // Check total reserve: sum of normal + (amt - fee)
        const feeAmt = (amt * 3n) / 100n;
        const expectedLiquidity = amt + (amt - feeAmt) + initialLiquidityAmountExpanded;
        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.liquidity).toEqual(expectedLiquidity);
    });

    await vm.it(
        'should allow another user to add liquidity to normal queue if one user is in priority',
        async () => {
            const user2 = Blockchain.generateRandomAddress();
            const amt = Blockchain.expandTo18Decimals(1000);

            await token.mintRaw(user2, amt);
            await token.increaseAllowance(userAddress, nativeSwap.address, amt);
            await token.increaseAllowance(user2, nativeSwap.address, amt);

            // userAddress: add priority
            await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: userAddress,
                amountIn: amt,
                priority: true,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });

            // user2: add normal
            Blockchain.msgSender = user2;
            Blockchain.txOrigin = user2;
            const resp = await nativeSwap.listLiquidity({
                token: tokenAddress,
                receiver: user2,
                amountIn: amt,
                priority: false,
                disablePriorityQueueFees: false,
                network: Blockchain.network,
            });
            Assert.expect(resp.response.error).toBeUndefined();

            // Confirm both are present
            const feeAmt = (amt * 3n) / 100n;
            const expectedLiquidity = amt - feeAmt + amt + initialLiquidityAmountExpanded;
            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
            Assert.expect(reserve.liquidity).toEqual(expectedLiquidity);
        },
    );

    await vm.it('should allow changing provider receiver address after swap', async () => {
        const amountIn = Blockchain.expandTo18Decimals(500);
        // Setup a single provider with normal liquidity
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn * 2n);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.increaseAllowance(provider, nativeSwap.address, amountIn * 2n);
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });

        // Make a reservation from a different user
        const buyer = Blockchain.generateRandomAddress();
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const satIn = 100_000_000n;
        const minOut = 1n;
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
        });

        const decodedReservation2 = NativeSwapTypesCoders.decodeReservationEvents(
            reservation.response.events,
        );

        createRecipientUTXOs(decodedReservation2.recipients);
        Blockchain.blockNumber = Blockchain.blockNumber + 2n;

        await nativeSwap.swap({
            token: tokenAddress,
        });

        // Now the provider tries to add more liquidity with a different receiver
        const newReceiver = Blockchain.generateRandomAddress();
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;

        // Should NOT revert
        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: newReceiver,
            amountIn: amountIn,
            priority: false,
            disablePriorityQueueFees: false,
            network: Blockchain.network,
        });
    });
});
