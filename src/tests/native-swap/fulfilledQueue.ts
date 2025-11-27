import { Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { OperationsHelper } from './helpers/OperationsHelper.js';
import {
    CreatePoolOperation,
    ListLiquidityOperation,
    ReserveOperation,
    SwapOperation,
    SwapOperationUTXOTypes,
} from '../utils/Operations.js';
import { ProviderHelper } from './helpers/ProviderHelper.js';

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

    await vm.it('1', async () => {
        Blockchain.blockNumber = 1000n;

        const token0 = opHelper.getToken(0);

        const createPoolOperation = new CreatePoolOperation(token0, 5000000n, 10000n);
        const token0InitialProvider = await createPoolOperation.execute(opHelper);

        Blockchain.blockNumber = 1001n;
        const list1Operation = new ListLiquidityOperation(
            Blockchain.generateRandomAddress(),
            token0,
            1000000000000n,
            false,
        );
        const lister1 = await list1Operation.execute(opHelper);
    });

    await vm.it('2', async () => {
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
            100000000000n,
            0n,
            1,
        );

        const reserveResult = await reserveOperation.execute(opHelper);

        Blockchain.blockNumber += 2n;
        Blockchain.log(`Swap`);

        const swapOperation: SwapOperation = new SwapOperation(
            SwapOperationUTXOTypes.FULL_UTXO,
            reserveResult.reservationId,
        );

        await swapOperation.execute(opHelper);
    });
});
