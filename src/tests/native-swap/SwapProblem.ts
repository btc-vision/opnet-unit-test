import { Assert, Blockchain, opnet } from '@btc-vision/unit-test-framework';
import { NativeSwapTestHelper } from './CommonTestMethods.js';

await opnet('Native Swap - Reservation Process', async (vm) => {
    const testHelper = new NativeSwapTestHelper(vm);

    testHelper.init();
    testHelper.afterEach();

    await vm.it('should crash.', async () => {
        Blockchain.enablePointerTracking();

        Blockchain.blockNumber = 4910n;

        await testHelper.randomReserve(10_000n, 1n);

        Blockchain.blockNumber += 1n;

        await testHelper.swapAll(false);

        vm.log(`Second swap:`);

        await Assert.expect(async () => {
            await testHelper.swapAll(false);
        }).toThrow('No active reservation for this address.');
    });
});
