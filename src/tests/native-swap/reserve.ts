import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';
import { helper_createToken, helper_reserve } from '../utils/OperationHelper.js';

await opnet('Native Swap - Reserve', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();
    let tokenAddress: Address;

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(userAddress, 18, 10_000_000);
        tokenAddress = token.address;

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should revert when invalid token address', async () => {
        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                new Address(),
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: Invalid token address`);

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                Blockchain.DEAD_ADDRESS,
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: Invalid token address`);
    });

    await vm.it('should revert when no pool created', async () => {
        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: No pool exists for token.`);

        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                Blockchain.generateRandomAddress(),
                userAddress,
                10000n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: No pool exists for token.`);
    });

    await vm.it('should revert when maximum amount is 0', async () => {
        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                0n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: Maximum amount in cannot be zero`);
    });

    await vm.it('should revert when maximum amount is below trade size', async () => {
        await Assert.expect(async () => {
            await helper_reserve(
                nativeSwap,
                tokenAddress,
                userAddress,
                10n,
                0n,
                false,
                false,
                false,
            );
        }).toThrow(`NATIVE_SWAP: Requested amount is below minimum trade size`);
    });
});
