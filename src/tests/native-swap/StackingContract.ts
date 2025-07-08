import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { NETWORK } from '../../../../unit-test-framework/build/contracts/configs.js';
import { networks } from '@btc-vision/bitcoin';

await opnet('Native Swap - Stacking contract', async (vm: OPNetUnit) => {
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

    await vm.it(
        'should sets stacking contract to dead address when contract is deploying',
        async () => {
            const stackingContractAddress = await nativeSwap.getStakingContractAddress();

            Assert.expect(stackingContractAddress.stakingContractAddress.toString()).toEqual(
                Address.dead().toString(),
            );
        },
    );

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

        const result = await nativeSwap.setStakingContractAddress({
            stakingContractAddress: stackingContractAddress,
        });

        Assert.expect(result.result).toEqual(true);

        const getResult = await nativeSwap.getStakingContractAddress();

        Assert.expect(getResult.stakingContractAddress.toString()).toEqual(
            stackingContractAddress.toString(),
        );
    });
});
