import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { networks } from '@btc-vision/bitcoin';

await opnet('Native Swap - Fees', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
    const randomFeesAddress: string =
        'bcrt1pg2w5yveumu3zvc6j6p3c0h0735fvz2xxd2wrlpyzxe3sltrsk8ksm35msv';

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
        'should correctly sets fees default values when contract is deploying',
        async () => {
            Blockchain.changeNetwork(networks.regtest);
            const fees = await nativeSwap.getFees();
            const feesAddress = await nativeSwap.getFeesAddress();

            Assert.expect(fees.reservationBaseFee).toEqual(NativeSwap.reservationFees);
            Assert.expect(fees.priorityQueueBaseFee).toEqual(NativeSwap.priorityQueueFees);
            Assert.expect(feesAddress.feesAddress).toEqual(NativeSwap.feeRecipient);
        },
    );

    await vm.it('should revert when caller is not the token owner', async () => {
        const fakeCallerAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = fakeCallerAddress;
        Blockchain.msgSender = fakeCallerAddress;

        await Assert.expect(async () => {
            await nativeSwap.setFees({
                priorityQueueBaseFee: 100n,
                reservationBaseFee: 1000n,
            });
        }).toThrow(`Only deployer can call this method`);
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

    await vm.it('should correctly sets fees when owner and in ranges', async () => {
        const setFeesResult = await nativeSwap.setFees({
            priorityQueueBaseFee: 500000n,
            reservationBaseFee: 1000n,
        });

        Assert.expect(setFeesResult.result).toEqual(true);

        const getFeesResult = await nativeSwap.getFees();

        Assert.expect(getFeesResult.priorityQueueBaseFee).toEqual(500000n);
        Assert.expect(getFeesResult.reservationBaseFee).toEqual(1000n);
    });

    await vm.it('should correctly sets fees address when owner and valid address', async () => {
        const setFeesAddressResult = await nativeSwap.setFeesAddress({
            feesAddress: randomFeesAddress,
        });

        Assert.expect(setFeesAddressResult.result).toEqual(true);

        const getFeesAddressResult = await nativeSwap.getFeesAddress();

        Assert.expect(getFeesAddressResult.feesAddress).toEqual(randomFeesAddress);
    });

    await vm.it('should revert when setting invalid fees address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.setFeesAddress({
                feesAddress: 'invalid address',
            });
        }).toThrow('RuntimeError: Invalid address: base58 error');
    });

    await vm.it('should revert when setting incorrect network fees address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.setFeesAddress({
                feesAddress: 'tb1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0q3cyz4c',
            });
        }).toThrow('NATIVE_SWAP: Fees address is an invalid bitcoin address.');
    });

    await vm.it('should revert when setting empty fees address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.setFeesAddress({
                feesAddress: '',
            });
        }).toThrow('NATIVE_SWAP: Fees address is empty.');
    });

    await vm.it('should revert when setting valid fees address but not owner', async () => {
        const fakeCallerAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = fakeCallerAddress;
        Blockchain.msgSender = fakeCallerAddress;

        await Assert.expect(async () => {
            await nativeSwap.setFeesAddress({
                feesAddress: randomFeesAddress,
            });
        }).toThrow('Only deployer can call this method');
    });
});
