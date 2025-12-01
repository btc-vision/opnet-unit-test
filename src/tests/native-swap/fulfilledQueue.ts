import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { OperationsHelper } from './helpers/OperationsHelper.js';
import {
    CreatePoolOperation,
    ListLiquidityOperation,
    ReserveOperation,
} from '../utils/Operations.js';
import { ProviderHelper } from './helpers/ProviderHelper.js';
import { helper_getQueueDetails, helper_getQuote } from '../utils/OperationHelper.js';

await opnet('Native Swap - Fulfilled queue', async (vm: OPNetUnit) => {
    const defaultInitialLiquidityAmount: bigint = Blockchain.expandTo18Decimals(1_000_000);
    const defaultfloorPrice: bigint = 100000000000000n;
    let opHelper: OperationsHelper;

    vm.beforeEach(async () => {
        opHelper = await OperationsHelper.create(10, true);
    });

    vm.afterEach(() => {
        opHelper.dispose();
    });
    /*
    await vm.it(
        'should resets 100 providers, push 40 to the fullfiled queue and resets them.',
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
        },
    );*/

    await vm.it('should sends 280 providers to the purge queue.', async () => {
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

        const detailsa = await helper_getQueueDetails(opHelper.nativeSwap, token0);

        Blockchain.blockNumber += 20n;

        Blockchain.log(`List -> clean expired reservations`);

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

        Blockchain.log(
            `List -> purge reservation-> send 280 providers to purge queue and try to simulate a price drop`,
        );
        Blockchain.blockNumber += 5n;
        for (let i = 0; i < 10; i++) {
            Blockchain.blockNumber += 1n;
            Blockchain.log(`Listing providers on block ${Blockchain.blockNumber}`);
            for (let j: bigint = 0n; j < 40n; j++) {
                const list1Operation = new ListLiquidityOperation(
                    Blockchain.generateRandomAddress(),
                    token0,
                    Blockchain.expandTo18Decimals(2155500),
                    false,
                );
                const lister = await list1Operation.execute(opHelper);
                listers.push(lister);
                const quote = await helper_getQuote(opHelper.nativeSwap, token0.token, 10n, false);
            }
        }

        const details = await helper_getQueueDetails(opHelper.nativeSwap, token0);

        Assert.expect(details.standardPurgeQueueLength).toEqual(280);

        Blockchain.log(`Reserve3`);
        const reserveOperation3: ReserveOperation = new ReserveOperation(
            token0,
            Blockchain.generateRandomAddress(),
            1900000000000n,
            0n,
            1,
        );

        const reserveResult3 = await reserveOperation3.execute(opHelper);

        const details2 = await helper_getQueueDetails(opHelper.nativeSwap, token0);
    });
});
