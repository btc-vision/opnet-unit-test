import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { OperationsHelper } from './helpers/OperationsHelper.js';
import {
    CreatePoolOperation,
    ListLiquidityOperation,
    ReserveOperation,
    SwapOperation,
    SwapOperationUTXOTypes,
} from '../utils/Operations.js';
import { ProviderHelper } from './helpers/ProviderHelper.js';
import { helper_getQueueDetails } from '../utils/OperationHelper.js';

await opnet('Native Swap - Fulfilled queue', async (vm: OPNetUnit) => {
    const defaultInitialLiquidityAmount: bigint = Blockchain.expandTo18Decimals(1_000_000);
    const defaultfloorPrice: bigint = 100000000000000n;
    let opHelper: OperationsHelper;

    vm.beforeEach(async () => {
        opHelper = await OperationsHelper.create(10, false);
    });

    vm.afterEach(() => {
        opHelper.dispose();
    });

    await vm.it(
        'should resets 200 providers, push 80 to the fullfiled queue and resets them.',
        async () => {
            Blockchain.blockNumber = 1000n;

            const token0 = opHelper.getToken(0);

            const createPoolOperation = new CreatePoolOperation(
                token0,
                defaultInitialLiquidityAmount,
                defaultfloorPrice,
            );
            const token0InitialProvider = await createPoolOperation.execute(opHelper);
            const listers: ProviderHelper[] = [];

            for (let i = 0; i < 10; i++) {
                Blockchain.blockNumber += 1n;
                Blockchain.log(`Listing providers on block ${Blockchain.blockNumber}`);
                for (let j: bigint = 0n; j < 40n; j++) {
                    const list1Operation = new ListLiquidityOperation(
                        Blockchain.generateRandomAddress(),
                        token0,
                        Blockchain.expandTo18Decimals(500),
                        false,
                    );
                    const lister = await list1Operation.execute(opHelper);
                    listers.push(lister);
                }
            }

            Blockchain.log(`Reserve`);
            const reserveOperation: ReserveOperation = new ReserveOperation(
                token0,
                Blockchain.generateRandomAddress(),
                1900000000000n,
                0n,
                1,
            );

            const reserveResult = await reserveOperation.execute(opHelper);

            const reserveOperation2: ReserveOperation = new ReserveOperation(
                token0,
                Blockchain.generateRandomAddress(),
                1900000000000n,
                0n,
                1,
            );

            const reserveResult2 = await reserveOperation2.execute(opHelper);

            let queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.standardQueueStartingIndex).toEqual(280);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardQueueLength).toEqual(400);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);

            Blockchain.blockNumber += 2n;
            Blockchain.log(`Swap`);

            const swapOperation: SwapOperation = new SwapOperation(
                SwapOperationUTXOTypes.FULL_UTXO,
                reserveResult.reservationId,
            );

            await swapOperation.execute(opHelper);

            const swapOperation2: SwapOperation = new SwapOperation(
                SwapOperationUTXOTypes.FULL_UTXO,
                reserveResult2.reservationId,
            );

            await swapOperation2.execute(opHelper);

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.standardQueueStartingIndex).toEqual(280);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardQueueLength).toEqual(400);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(80);

            Blockchain.blockNumber += 10n;

            Blockchain.log(`List`);
            const listOperation2 = new ListLiquidityOperation(
                Blockchain.generateRandomAddress(),
                token0,
                Blockchain.expandTo18Decimals(500),
                false,
            );
            const lister2 = await listOperation2.execute(opHelper);
            listers.push(lister2);

            const listOperation3 = new ListLiquidityOperation(
                Blockchain.generateRandomAddress(),
                token0,
                Blockchain.expandTo18Decimals(500),
                false,
            );
            const lister3 = await listOperation3.execute(opHelper);
            listers.push(lister3);
            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.standardQueueStartingIndex).toEqual(280);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardQueueLength).toEqual(402);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);
        },
    );

    await vm.it(
        'should send normal and priority providers to fulfilled queue and then be resets.',
        async () => {
            Blockchain.blockNumber = 1000n;

            const token0 = opHelper.getToken(0);

            const createPoolOperation = new CreatePoolOperation(
                token0,
                defaultInitialLiquidityAmount,
                defaultfloorPrice,
            );

            await createPoolOperation.execute(opHelper);
            const listers: ProviderHelper[] = [];

            // List 400 normal providers
            for (let i = 0; i < 10; i++) {
                Blockchain.blockNumber += 1n;
                Blockchain.log(`Listing normal providers on block ${Blockchain.blockNumber}`);
                for (let j: bigint = 0n; j < 40n; j++) {
                    const list1Operation = new ListLiquidityOperation(
                        Blockchain.generateRandomAddress(),
                        token0,
                        Blockchain.expandTo18Decimals(500),
                        false,
                    );
                    const lister = await list1Operation.execute(opHelper);
                    listers.push(lister);
                }
            }

            // List 400 priority providers
            for (let i = 0; i < 10; i++) {
                Blockchain.blockNumber += 1n;
                Blockchain.log(`Listing priority providers on block ${Blockchain.blockNumber}`);
                for (let j: bigint = 0n; j < 40n; j++) {
                    const list1Operation = new ListLiquidityOperation(
                        Blockchain.generateRandomAddress(),
                        token0,
                        Blockchain.expandTo18Decimals(200),
                        true,
                    );
                    const lister = await list1Operation.execute(opHelper);
                    listers.push(lister);
                }
            }

            let queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.standardQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(400);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);

            // Reserve. Should use 140 priority providers
            Blockchain.log(`Reserve1`);
            const reserveOperation: ReserveOperation = new ReserveOperation(
                token0,
                Blockchain.generateRandomAddress(),
                1900000000000n,
                0n,
                1,
            );

            await reserveOperation.execute(opHelper);

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityQueueStartingIndex).toEqual(140);
            Assert.expect(queueDetails.standardQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(400);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);

            // Reserve. Should use 140 priority providers
            Blockchain.log(`Reserve2`);
            const reserveOperation2: ReserveOperation = new ReserveOperation(
                token0,
                Blockchain.generateRandomAddress(),
                1900000000000n,
                0n,
                1,
            );

            await reserveOperation2.execute(opHelper);

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityQueueStartingIndex).toEqual(280);
            Assert.expect(queueDetails.standardQueueStartingIndex).toEqual(0);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(400);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);

            Blockchain.blockNumber += 20n;

            // Restore expired reservations. Send providers to purged queue.
            Blockchain.log(`Restore expired reservations`);

            const listOperation2 = new ListLiquidityOperation(
                Blockchain.generateRandomAddress(),
                token0,
                Blockchain.expandTo18Decimals(500),
                false,
                false,
                0,
                true,
                2,
            );

            const lister2 = await listOperation2.execute(opHelper);
            listers.push(lister2);

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityPurgeQueueLength).toEqual(280);
            Assert.expect(queueDetails.standardPurgeQueueLength).toEqual(0);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(401);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);

            Blockchain.log(`List -> simulate a price drop`);
            Blockchain.blockNumber += 5n;
            for (let i = 0; i < 10; i++) {
                Blockchain.blockNumber += 1n;
                Blockchain.log(`Listing normal providers on block ${Blockchain.blockNumber}`);
                for (let j: bigint = 0n; j < 40n; j++) {
                    const list1Operation = new ListLiquidityOperation(
                        Blockchain.generateRandomAddress(),
                        token0,
                        Blockchain.expandTo18Decimals(2155500),
                        false,
                    );
                    const lister = await list1Operation.execute(opHelper);
                    listers.push(lister);
                }
            }

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityPurgeQueueLength).toEqual(280);
            Assert.expect(queueDetails.standardPurgeQueueLength).toEqual(0);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(801);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);

            // Do a reservation. Will clear the priority purged queue and resets 100 providers then fill the fulfilled queue.
            Blockchain.log(`Reserve3`);
            const reserveOperation3: ReserveOperation = new ReserveOperation(
                token0,
                Blockchain.generateRandomAddress(),
                1900000000000n,
                0n,
                1,
            );

            await reserveOperation3.execute(opHelper);

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityPurgeQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardPurgeQueueLength).toEqual(0);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(801);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(300);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(401);

            Blockchain.log(`Empty the fulfilled queues`);
            for (let i = 0; i < 18; i++) {
                Blockchain.blockNumber += 1n;
                Blockchain.log(`Listing providers on block ${Blockchain.blockNumber}`);
                const list1Operation = new ListLiquidityOperation(
                    Blockchain.generateRandomAddress(),
                    token0,
                    Blockchain.expandTo18Decimals(2155500),
                    false,
                );
                const lister = await list1Operation.execute(opHelper);
                listers.push(lister);
            }

            queueDetails = await helper_getQueueDetails(opHelper.nativeSwap, token0, false);

            Assert.expect(queueDetails.priorityPurgeQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardPurgeQueueLength).toEqual(140);
            Assert.expect(queueDetails.priorityQueueLength).toEqual(400);
            Assert.expect(queueDetails.standardQueueLength).toEqual(819);
            Assert.expect(queueDetails.priorityFulfilledQueueLength).toEqual(0);
            Assert.expect(queueDetails.standardFulfilledQueueLength).toEqual(0);
        },
    );
});
