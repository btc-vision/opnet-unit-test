import {
    Assert,
    Blockchain,
    generateTransactionId,
    opnet,
    OPNetUnit,
    Transaction,
} from '@btc-vision/unit-test-framework';
import { expandNumberTo18Decimals } from './helpers/UtilsHelper.js';
import {
    BaseOperation,
    CancelListingOperation,
    CreatePoolOperation,
    ListLiquidityOperation,
    RelistLiquidityOperation,
    ReserveOperation,
    SwapOperation,
    SwapOperationUTXOTypes,
} from './helpers/OperationHelper.js';
import {
    cancelLiquidity,
    createPool,
    createTokens,
    disposeBlockchain,
    getProviderByAddress,
    getReservation,
    getToken,
    initBlockchain,
    initNativeSwap,
    listLiquidity,
    relistLiquidity,
    reserveLiquidity,
    swap,
    TOKEN_NUMBER,
} from './helpers/TrackPriceBalanceHelper.js';

await opnet('Native Swap - Track price and balance', async (vm: OPNetUnit) => {
    async function executeOperation(operation: BaseOperation) {
        if (operation instanceof CreatePoolOperation) {
            if (operation.throws) {
                await Assert.expect(async () => {
                    await createPool(
                        operation.tokenHelper,
                        operation.initialLiquidityAmount,
                        operation.floorPrice,
                    );
                }).toThrow();
            } else {
                await Assert.expect(async () => {
                    await createPool(
                        operation.tokenHelper,
                        operation.initialLiquidityAmount,
                        operation.floorPrice,
                    );
                }).toNotThrow();
            }
        } else if (operation instanceof ListLiquidityOperation) {
            if (operation.throws) {
                await Assert.expect(async () => {
                    await listLiquidity(
                        operation.tokenHelper,
                        operation.address,
                        operation.amountIn,
                        operation.priority,
                    );
                }).toThrow();
            } else {
                await Assert.expect(async () => {
                    await listLiquidity(
                        operation.tokenHelper,
                        operation.address,
                        operation.amountIn,
                        operation.priority,
                    );
                }).toNotThrow();
            }
        } else if (operation instanceof RelistLiquidityOperation) {
            const provider = getProviderByAddress(operation.address);

            Assert.expect(provider).toNotEqual(null);
            if (provider === null) {
                throw new Error(`Provider ${operation.address} not found`);
            }

            const willThrows: boolean =
                operation.throws ||
                provider.canProvideLiquidity ||
                provider.reserved !== 0n ||
                provider.isPurged ||
                (provider.isPriority && !operation.priority);

            if (willThrows) {
                await Assert.expect(async () => {
                    await relistLiquidity(provider, operation.amountIn, operation.priority);
                }).toThrow();
            } else {
                await Assert.expect(async () => {
                    await relistLiquidity(provider, operation.amountIn, operation.priority);
                }).toNotThrow();
            }
        } else if (operation instanceof CancelListingOperation) {
            const provider = getProviderByAddress(operation.address);

            Assert.expect(provider).toNotEqual(null);
            if (provider === null) {
                throw new Error(`Provider ${operation.address} not found`);
            }

            const willThrows: boolean =
                operation.throws ||
                provider.listedTokenAt !== 18446744073709551615n ||
                !provider.isActive ||
                provider.reserved !== 0n ||
                !provider.isPurged ||
                provider.liquidity !== 0n ||
                provider.canProvideLiquidity ||
                !provider.initialLiquidityProvider;

            if (willThrows) {
                await Assert.expect(async () => {
                    await cancelLiquidity(provider);
                }).toThrow();
            } else {
                await Assert.expect(async () => {
                    await cancelLiquidity(provider);
                }).toNotThrow();
            }
        } else if (operation instanceof ReserveOperation) {
            const canThrow: boolean = operation.minAmountOutTokens > 0n;

            if (operation.throws) {
                await Assert.expect(async () => {
                    await reserveLiquidity(
                        operation.tokenHelper,
                        operation.reserver,
                        operation.amountInSats,
                        operation.minAmountOutTokens,
                        operation.activationDelay,
                        operation.feesAddress,
                    );
                }).toThrow();
            } else if (canThrow) {
                try {
                    await reserveLiquidity(
                        operation.tokenHelper,
                        operation.reserver,
                        operation.amountInSats,
                        operation.minAmountOutTokens,
                        operation.activationDelay,
                        operation.feesAddress,
                    );
                } catch (e) {
                    if (e instanceof Error) {
                        Assert.expect(
                            e.message.startsWith(
                                `NATIVE_SWAP: No liquidity reserved; no more liquidity available.`,
                            ) ||
                                e.message.startsWith(
                                    `NATIVE_SWAP: Not enough liquidity reserved; wanted`,
                                ),
                        ).toEqual(true);
                    } else {
                        Assert.expect(false).toEqual(true);
                    }
                }
            } else {
                await Assert.expect(async () => {
                    await reserveLiquidity(
                        operation.tokenHelper,
                        operation.reserver,
                        operation.amountInSats,
                        operation.minAmountOutTokens,
                        operation.activationDelay,
                        operation.feesAddress,
                    );
                }).toNotThrow();
            }
        } else if (operation instanceof SwapOperation) {
            const reservation = getReservation(operation.reservationId);

            Assert.expect(reservation).toNotEqual(null);
            if (reservation === null) {
                throw new Error(`Reservation don't exists ${operation.address}`);
            }

            let transaction: Transaction;

            switch (operation.UTXOType) {
                case SwapOperationUTXOTypes.FULL_UTXO:
                    transaction = reservation.createTransaction();
                    break;
                case SwapOperationUTXOTypes.PARTIAL_UTXO:
                    transaction = reservation.createTransaction();
                    break;
                case SwapOperationUTXOTypes.NO_UTXO:
                    transaction = new Transaction(generateTransactionId(), [], []);
                    break;
                default:
                    throw new Error('Unsupported UTXO type');
            }

            if (operation.throws) {
                await Assert.expect(async () => {
                    await swap(reservation, transaction);
                }).toThrow();
            } else {
                await Assert.expect(async () => {
                    await swap(reservation, transaction);
                }).toNotThrow();
            }
        }
    }

    function buildOperations(): Map<bigint, BaseOperation[]> {
        let currentBlock = 100n;
        const operationMap = new Map<bigint, BaseOperation[]>();
        const operations: BaseOperation[] = [];

        operationMap.set(currentBlock, operations);

        for (let i = 0; i < TOKEN_NUMBER; i++) {
            const token = getToken(i);
            const floor = Math.floor(Math.random() * 6) + 15;
            const op = new CreatePoolOperation(
                token.ownerAddress,
                false,
                currentBlock,
                token,
                expandNumberTo18Decimals(250000000),
                expandNumberTo18Decimals(floor) / 1500n,
            );

            operations.push(op);
        }

        return operationMap;
    }

    vm.beforeEach(async () => {
        await initBlockchain();
        await createTokens();
        await initNativeSwap();
    });

    vm.afterEach(() => {
        disposeBlockchain();
    });

    await vm.it('', async () => {
        const operationMap = buildOperations();

        for (const [key, value] of operationMap.entries()) {
            Blockchain.blockNumber = key;
            for (const operation of value) {
                await executeOperation(operation);
            }
        }

        /*
        Blockchain.blockNumber = 1000n;
        const intialProvider: ProviderHelper = await createPool(
            getToken(0),
            expandNumberTo18Decimals(10000001),
            expandNumberTo18Decimals(17),
        );

        Blockchain.blockNumber += 10n;
        const provider1: ProviderHelper = await listLiquidity(
            getToken(0),
            Blockchain.generateRandomAddress(),
            expandBigIntTo18Decimals(100000230n), //expandBigIntTo18Decimals(100000000n),
        );

        Blockchain.blockNumber += 100n;

        Blockchain.log('cancel');
        await cancelLiquidity(provider1);
        
        Blockchain.log('reservation 1');

        const reservation = await reserveLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            10000000n,
        );

        if (reservation === null) {
            throw new Error('Cannot reserve.');
        }

        Blockchain.blockNumber += 3n;
        Blockchain.log('swap');
        await swap(reservation, null);
*/
        //!!! Adjust virtualtokenreserve in cancel and list
        /*
        Blockchain.blockNumber += 20n;

        Blockchain.log('reservation 2');
        const r3 = await LiquidityReserveHelper.create(nativeSwap, tokenArray[0]);
        r3.logToConsole();
        const reservation2 = await reserveLiquidity(
            tokenArray[0],
            Blockchain.generateRandomAddress(),
            10000000n,
        );

        Blockchain.log('reservation 1-1');
        if (reservation !== null) {
            reservation.logToConsole();
        }

        Blockchain.log('reservation 2-1');
        if (reservation2 !== null) {
            reservation2.logToConsole();
            const r4 = await LiquidityReserveHelper.create(nativeSwap, tokenArray[0]);
            r4.logToConsole();
        }
        
 */
    });
});
