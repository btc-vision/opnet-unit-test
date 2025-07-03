import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    gas2BTC,
    gas2Sat,
    gas2USD,
    generateEmptyTransaction,
    OP_20,
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

await opnet('NativeSwap: pause', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    const liquidityOwner: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP_20({
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

    await vm.it('should fail to pause the contract if the caller is not the owner', async () => {
        Blockchain.blockNumber = 1000n;
        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await nativeSwap.pause();
        }).toThrow();
    });

    await vm.it('should pause the contract if the caller is the owner', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(false);

        await nativeSwap.pause();

        const newPauseState = await nativeSwap.isPaused();
        console.log(newPauseState.isPaused);
        Assert.expect(newPauseState.isPaused).toEqual(true);
    });

    await vm.it(
        'should not change the pause state of the contract if the caller is the owner and already on pause',
        async () => {
            Blockchain.blockNumber = 1000n;

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            const currentPauseState = await nativeSwap.isPaused();
            Assert.expect(currentPauseState.isPaused).toEqual(false);

            await nativeSwap.pause();
            const newPauseState = await nativeSwap.isPaused();
            Assert.expect(newPauseState.isPaused).toEqual(true);

            await nativeSwap.pause();
            const newPauseState2 = await nativeSwap.isPaused();
            Assert.expect(newPauseState2.isPaused).toEqual(true);
        },
    );

    await vm.it('should fail to unpause the contract if the caller is not the owner', async () => {
        Blockchain.blockNumber = 1000n;
        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await nativeSwap.unpause();
        }).toThrow();
    });

    await vm.it('should unpause the contract if the caller is the owner', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();

        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

        await nativeSwap.unpause();

        const newPauseState = await nativeSwap.isPaused();
        Assert.expect(newPauseState.isPaused).toEqual(false);
    });

    await vm.it(
        'should not change the pause state of the contract if the caller is the owner and already not paused',
        async () => {
            Blockchain.blockNumber = 1000n;

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.pause();
            const currentPauseState = await nativeSwap.isPaused();
            Assert.expect(currentPauseState.isPaused).toEqual(true);

            await nativeSwap.unpause();
            const newPauseState = await nativeSwap.isPaused();
            Assert.expect(newPauseState.isPaused).toEqual(false);

            await nativeSwap.unpause();
            const newPauseState2 = await nativeSwap.isPaused();
            Assert.expect(newPauseState2.isPaused).toEqual(false);
        },
    );

    await vm.it('should return false when the contract is not paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.unpause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(false);
    });

    await vm.it('should return true when the contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);
    });

    await vm.it('should fail to call reserve when contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

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

    await vm.it('should fail to call swap when contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await helper_swap(nativeSwap, tokenAddress, randomOwner, false);
        }).toThrow();
    });

    await vm.it('should fail to call listLiquidity when contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

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

    await vm.it('should fail to call cancelListing when contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: tokenAddress,
            });
        }).toThrow();
    });

    await vm.it('should fail to call createpool when contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

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

    await vm.it('should fail to call setfee when contract is paused', async () => {
        Blockchain.blockNumber = 1000n;

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        await nativeSwap.pause();
        const currentPauseState = await nativeSwap.isPaused();
        Assert.expect(currentPauseState.isPaused).toEqual(true);

        const randomOwner = Blockchain.generateRandomAddress();

        Blockchain.msgSender = randomOwner;
        Blockchain.txOrigin = randomOwner;

        await Assert.expect(async () => {
            await nativeSwap.setFees({ reservationBaseFee: 1000n, priorityQueueBaseFee: 10000n });
        }).toThrow();
    });

    await vm.it(
        'should fail to call setStakingContractAddress when contract is paused',
        async () => {
            Blockchain.blockNumber = 1000n;

            Blockchain.msgSender = userAddress;
            Blockchain.txOrigin = userAddress;

            await nativeSwap.pause();
            const currentPauseState = await nativeSwap.isPaused();
            Assert.expect(currentPauseState.isPaused).toEqual(true);

            const randomOwner = Blockchain.generateRandomAddress();

            Blockchain.msgSender = randomOwner;
            Blockchain.txOrigin = randomOwner;

            await Assert.expect(async () => {
                await nativeSwap.setStakingContractAddress({
                    stakingContractAddress: Blockchain.generateRandomAddress(),
                });
            }).toThrow();
        },
    );
});
