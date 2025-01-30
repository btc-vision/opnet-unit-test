import { Assert, Blockchain, opnet } from '@btc-vision/unit-test-framework';
import { NativeSwapTestHelper } from './CommonTestMethods.js';
import { gas2USD } from '../utils/TransactionUtils.js';

await opnet('Native Swap - Reservation Process', async (vm) => {
    const testHelper = new NativeSwapTestHelper(vm);

    testHelper.startBlock = 4908n;
    testHelper.init();
    testHelper.afterEach();

    await vm.it('should crash.', async () => {
        //Blockchain.enablePointerTracking();

        Blockchain.blockNumber = 4910n;

        await testHelper.randomReserve(10_000n, 1n);

        Blockchain.blockNumber += 1n;

        await testHelper.swapAll(false);

        vm.log(`Second swap:`);

        await Assert.expect(async () => {
            await testHelper.swapAll(false);
        }).toThrow('No active reservation for this address.');

        testHelper.startBlock = 1n;
    });

    /*
    await vm.it('should be cheap to purge if user swapped', async () => {
        const initialReserve = await testHelper.nativeSwap.getReserve({
            token: testHelper.tokenAddress,
        });

        Blockchain.blockNumber = 1000n;

        // Create 50 reservations over 10 different blocks
        for (let i = 0; i < 5; i++) {
            Blockchain.blockNumber = 1000n + BigInt(i);

            for (let x = 0; x < 10; x++) {
                await testHelper.randomReserve(10_000n, 1n);
            }
        }

        const before = await testHelper.nativeSwap.getReserve({
            token: testHelper.tokenAddress,
        });

        // Advance beyond expiration
        Blockchain.blockNumber = 20000n;

        // Purge
        const a = await testHelper.randomReserve(10_000n, 1n);
        vm.log(`Spent ${gas2USD(a.response.usedGas)} USD to purge and reserve 50 reservations.`);

        const after = await testHelper.nativeSwap.getReserve({
            token: testHelper.tokenAddress,
        });

        Assert.expect(after.liquidity).toEqual(initialReserve.liquidity);
        Assert.expect(after.reservedLiquidity).toBeLessThan(before.reservedLiquidity);
    });
     */

    await vm.it('should be cheap to purge if user swapped', async () => {
        Blockchain.blockNumber = 1000n;

        // Create 50 reservations over 10 different blocks
        for (let i = 0; i < 100; i++) {
            await testHelper.randomReserve(10_000n, 1n);
        }

        Blockchain.blockNumber += 1n;

        const before = await testHelper.nativeSwap.getReserve({
            token: testHelper.tokenAddress,
        });

        await testHelper.swapAll(true);

        // Advance beyond expiration
        Blockchain.blockNumber = 20000n;

        // Purge
        const a = await testHelper.randomReserve(10_000n, 1n);
        vm.log(`Spent ${gas2USD(a.response.usedGas)} USD to purge and reserve 50 reservations.`);

        const after = await testHelper.nativeSwap.getReserve({
            token: testHelper.tokenAddress,
        });

        console.log(after.reservedLiquidity);

        Assert.expect(after.reservedLiquidity).toBeLessThan(before.reservedLiquidity);
    });
});
