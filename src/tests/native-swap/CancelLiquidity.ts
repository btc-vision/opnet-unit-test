import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    gas2BTC,
    gas2Sat,
    gas2USD,
    generateEmptyTransaction,
    OP_20,
    opnet,
    OPNetUnit,
    Transaction,
} from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { ListLiquidityResult, Recipient } from '../../contracts/NativeSwapTypes.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('NativeSwap: Priority and Normal Queue cancelliquidity', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const userAddress: Address = receiver;
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    const liquidityOwner: Address = Blockchain.generateRandomAddress();
    const initialLiquidityAddress: string = liquidityOwner.p2tr(Blockchain.network);
    const initialLiquidityAmount: bigint = Blockchain.expandTo18Decimals(1_000_000);

    async function mintAndApprove(amount: bigint, to: Address): Promise<void> {
        const addyBefore = Blockchain.msgSender;

        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await token.mintRaw(to, amount);

        Blockchain.txOrigin = addyBefore;
        Blockchain.msgSender = addyBefore;

        await token.approve(addyBefore, nativeSwap.address, amount);
    }

    /**
     * Creates a pool by:
     *  1) Minting the initialLiquidity amount of tokens to userAddress
     *  2) Approving that amount for NativeSwap contract
     *  3) Calling nativeSwap.createPool(...)
     */
    async function createPool(floorPrice: bigint, initialLiquidity: bigint): Promise<void> {
        Blockchain.txOrigin = liquidityOwner;
        Blockchain.msgSender = liquidityOwner;

        await mintAndApprove(initialLiquidity, liquidityOwner);

        // Create the pool
        const result = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: initialLiquidityAddress,
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 40,
        });

        vm.debug(
            `Pool created! Gas cost: ${gas2Sat(result.response.usedGas)} sat (${gas2BTC(
                result.response.usedGas,
            )} BTC, $${gas2USD(result.response.usedGas)})`,
        );

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    }

    async function listToken(
        amountIn: number,
        priority: boolean,
        providerAddress: Address,
    ): Promise<void> {
        const realAmountIn = Blockchain.expandTo18Decimals(amountIn);
        await token.mintRaw(providerAddress, realAmountIn);
        await token.approve(providerAddress, nativeSwap.address, realAmountIn);

        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: providerAddress.p2tr(Blockchain.network),
            amountIn: realAmountIn,
            priority: priority,
            disablePriorityQueueFees: false,
        });
    }

    async function reserve(satIn: bigint): Promise<Recipient[]> {
        const reservation = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: 1n,
            forLP: false,
        });

        const decodedReservation2 = NativeSwapTypesCoders.decodeReservationEvents(
            reservation.response.events,
        );

        return decodedReservation2.recipients;
    }

    async function swap(recipient: Recipient[]): Promise<void> {
        createRecipientUTXOs(recipient);

        await nativeSwap.swap({
            token: tokenAddress,
        });
    }

    async function reserveSwap(satIn: bigint): Promise<void> {
        const recipient = await reserve(satIn);
        Blockchain.blockNumber += 3n;
        await swap(recipient);
    }

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP_20({
            file: 'MyToken',
            deployer: liquidityOwner,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        // Give user some extra tokens beyond the initial liquidity
        // so that subsequent "addLiquidity(...)" calls can work
        await token.mint(userAddress, 10_000_000);

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await createPool(100000000000000n, initialLiquidityAmount);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should fail to cancel liquidity when no liquidity listed', async () => {
        Blockchain.blockNumber = 1000n;
        const provider = Blockchain.generateRandomAddress();
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;

        await Assert.expect(async () => {
            await nativeSwap.cancelListing({
                token: tokenAddress,
            });
        }).toThrow('NATIVE_SWAP: Provider is not listed.');
    });

    await vm.it(
        'should fail to cancel liquidity when provider liquidity has been consumed',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2n;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await reserveSwap(100000000000n);

            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;
                Blockchain.msgSender = provider;
                Blockchain.txOrigin = provider;
                await nativeSwap.cancelListing({
                    token: tokenAddress,
                });
            }).toThrow('NATIVE_SWAP: Provider is not listed.');
        },
    );

    await vm.it(
        'should fail to cancel liquidity when provider is providing liquidity',
        async () => {
            Blockchain.blockNumber = 1000n;
            const provider = Blockchain.generateRandomAddress();
            Blockchain.msgSender = provider;
            Blockchain.txOrigin = provider;
            await listToken(10000, false, provider);

            Blockchain.blockNumber += 2n;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await reserveSwap(10000n);

            await Assert.expect(async () => {
                Blockchain.blockNumber += 1n;
                Blockchain.msgSender = provider;
                Blockchain.txOrigin = provider;
                await nativeSwap.cancelListing({
                    token: tokenAddress,
                });
            }).toThrow(
                'NATIVE_SWAP: You can no longer cancel this listing. Provider is providing liquidity.',
            );
        },
    );
});
