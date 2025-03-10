import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';

await opnet('Native Swap - Get/Set Fees', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the nativeSwap contract
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

    await vm.it('should revert when caller is not the token owner', async () => {
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

    await vm.it('should revert when reservation base fee exceed the cap', async () => {
        await Assert.expect(async () => {
            await nativeSwap.setFees({
                priorityQueueBaseFee: 100n,
                reservationBaseFee: 100001n,
            });
        }).toThrow(`Reservation base fee cannot exceed the cap`);
    });

    await vm.it('should revert when priority queue base fee exceed the cap', async () => {
        await Assert.expect(async () => {
            await nativeSwap.setFees({
                priorityQueueBaseFee: 500001n,
                reservationBaseFee: 1000n,
            });
        }).toThrow(`Priority queue base fee cannot exceed the cap`);
    });

    await vm.it('fees should be correctly setted when owner and in ranges ', async () => {
        const setFeesResult = await nativeSwap.setFees({
            priorityQueueBaseFee: 500000n,
            reservationBaseFee: 1000n,
        });

        Assert.expect(setFeesResult.result).toEqual(true);

        const getFeesResult = await nativeSwap.getFees();

        Assert.expect(getFeesResult.priorityQueueBaseFee).toEqual(500000n);
        Assert.expect(getFeesResult.reservationBaseFee).toEqual(1000n);
    });
});
