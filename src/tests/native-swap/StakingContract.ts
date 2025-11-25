import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';

await opnet('Native Swap - Staking contract', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        Blockchain.dispose();
    });

    await vm.it('should sets stacking contract address when contract is deploying', async () => {
        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: Blockchain.generateRandomAddress(),
        });

        const stackingContractAddress = await nativeSwap.getStakingContractAddress();

        Assert.expect(stackingContractAddress.stakingContractAddress.toString()).toNotEqual(
            Address.dead().toString(),
        );
    });

    await vm.it('should revert when caller is not the token owner', async () => {
        const fakeCallerAddress: Address = Blockchain.generateRandomAddress();
        const stackingContractAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = fakeCallerAddress;
        Blockchain.msgSender = fakeCallerAddress;

        await Assert.expect(async () => {
            await nativeSwap.setStakingContractAddress({
                stakingContractAddress: stackingContractAddress,
            });
        }).toThrow(`Only deployer can call this method`);
    });

    await vm.it('should correctly sets stacking contract address when owner', async () => {
        const stackingContractAddress: Address = Blockchain.generateRandomAddress();

        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: stackingContractAddress,
        });

        const getResult = await nativeSwap.getStakingContractAddress();

        Assert.expect(getResult.stakingContractAddress.toString()).toEqual(
            stackingContractAddress.toString(),
        );
    });

    await vm.it('should fail to sets stacking contract address if zero address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.setStakingContractAddress({
                stakingContractAddress: new Address(),
            });
        }).toThrow('NATIVE_SWAP: Staking contract address cannot be empty.');
    });
});
