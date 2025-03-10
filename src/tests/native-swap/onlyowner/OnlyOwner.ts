import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../../contracts/NativeSwap.js';

await opnet('Native Swap - Onlyowner tests', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        Blockchain.dispose();
    });

    await vm.it('should revert when setFees caller is not the contract owner', async () => {
        const fakeCallerAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = fakeCallerAddress;
        Blockchain.msgSender = fakeCallerAddress;

        await Assert.expect(async () => {
            await nativeSwap.setFees({
                priorityQueueBaseFee: 100n,
                reservationBaseFee: 1000n,
            });
        }).toThrow(`Only owner can call this method`);
    });

    await vm.it(
        'should revert when setStakingContractAddress caller is not the contract owner',
        async () => {
            const fakeCallerAddress: Address = Blockchain.generateRandomAddress();

            Blockchain.txOrigin = fakeCallerAddress;
            Blockchain.msgSender = fakeCallerAddress;

            await Assert.expect(async () => {
                await nativeSwap.setStakingContractAddress({
                    stakingContractAddress: stakingContractAddress,
                });
            }).toThrow(`Only owner can call this method`);
        },
    );
});
