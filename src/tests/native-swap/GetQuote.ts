import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';
import { NativeSwapTypesCoders } from '../../contracts/ewma/NativeSwapTypesCoders.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';

await opnet('Native Swap - Get Quote', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    async function reserve(amount: bigint, provider: Address): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const reservationResponse = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: amount,
            minimumAmountOut: 0n,
            forLP: false,
        });

        Blockchain.log(`Reserved`);
        Blockchain.log(`totalSats: ${reservationResponse.totalSatoshis}`);
        Blockchain.log(`amountOut: ${reservationResponse.expectedAmountOut}`);
        Blockchain.log(``);

        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            reservationResponse.response.events,
        );

        const satSent = amount;
        for (let i = 0; i < decodedReservation.recipients.length; i++) {
            decodedReservation.recipients[i].amount = satSent;
        }

        createRecipientUTXOs(decodedReservation.recipients);

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
    }

    async function swap(provider: Address): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const result = await nativeSwap.swap({
            token: tokenAddress,
            isSimulation: false,
        });

        const swapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
            result.response.events[result.response.events.length - 1].data,
        );

        Blockchain.log(`Swap result`);
        Blockchain.log(`totalSatoshisSpent: ${swapEvent.amountIn}`);
        Blockchain.log(`totalTokensPurchased: ${swapEvent.amountOut}`);
        //Blockchain.log(`buyer: ${swapEvent.buyer}`);

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
    }

    async function createDefaultLiquidityPool(): Promise<void> {
        const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
        const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.approve(userAddress, nativeSwap.address, liquidityAmount);

        const quote = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: 10n,
            initialLiquidity: 2000000n,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 60000,
        });

        Assert.expect(quote.result).toEqual(true);
    }

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the OP_20 token
        token = new OP_20({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });

        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        await token.mint(userAddress, 10_000_000);

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
            await nativeSwap.getQuote({
                token: new Address(),
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);

        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: Blockchain.DEAD_ADDRESS,
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);
    });

    await vm.it('should revert when no pool created', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: No pool exists for token.`);

        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: Blockchain.generateRandomAddress(),
                satoshisIn: 10n,
            });
        }).toThrow(`NATIVE_SWAP: No pool exists for token.`);
    });

    await vm.it('should revert when maximum amount is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 0n,
            });
        }).toThrow(`NATIVE_SWAP: Maximum amount in cannot be zero`);
    });

    await vm.it('should revert when price is 0', async () => {
        const provider: Address = Blockchain.generateRandomAddress();

        // mettre 1 satoshi = 1 token
        // swap 2 fois
        await createDefaultLiquidityPool();

        for (let i = 0; i < 10; i++) {
            Blockchain.log(`${i}`);
            Blockchain.log(`-------------`);
            Blockchain.log(`Reserve`);
            await reserve(60000n, provider);

            Blockchain.log(`Get reserve`);
            const reserveResult = await nativeSwap.getReserve({
                token: token.address,
            });

            Blockchain.log(`Reserve result`);
            Blockchain.log(`Liquidity: ${reserveResult.liquidity}`);
            Blockchain.log(`ReservedLiquidity: ${reserveResult.reservedLiquidity}`);
            Blockchain.log(`VirtualBTCReserve: ${reserveResult.virtualBTCReserve}`);
            Blockchain.log(`VirtualTokenReserve: ${reserveResult.virtualTokenReserve}`);
            Blockchain.log(``);

            Blockchain.blockNumber = Blockchain.blockNumber + 1n;

            Blockchain.log(``);
            Blockchain.log(`Swap`);
            await swap(provider);

            Blockchain.log(``);
            Blockchain.log(`Get reserve`);
            const reserveResult2 = await nativeSwap.getReserve({
                token: token.address,
            });

            Blockchain.log(`Reserve result`);
            Blockchain.log(`Liquidity: ${reserveResult2.liquidity}`);
            Blockchain.log(`ReservedLiquidity: ${reserveResult2.reservedLiquidity}`);
            Blockchain.log(`VirtualBTCReserve: ${reserveResult2.virtualBTCReserve}`);
            Blockchain.log(`VirtualTokenReserve: ${reserveResult2.virtualTokenReserve}`);
            Blockchain.log(``);
        }
        /*await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 1000n,
            });
        }).toThrow(`NATIVE_SWAP: Price is zero or no liquidity`);*/
    });

    await vm.it('should revert when virtualBTCReserve is 0', async () => {
        /*await Assert.expect(async () => {
            await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 1000n,
            });
        }).toThrow(`NOT_ENOUGH_LIQUIDITY`);*/
    });

    await vm.it(
        'should return the values when liquidity is greater than the number of tokens for the given amount',
        async () => {
            await createDefaultLiquidityPool();

            const getQuoteResult = await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 500n,
            });

            Assert.expect(getQuoteResult.price).toEqual(10n);
            Assert.expect(getQuoteResult.requiredSatoshis).toEqual(500n);
            Assert.expect(getQuoteResult.tokensOut).toEqual(5000n);
        },
    );

    await vm.it(
        'should return a capped  values when liquidity is smaller than the number of tokens for the given amount',
        async () => {
            await createDefaultLiquidityPool();

            const getQuoteResult = await nativeSwap.getQuote({
                token: token.address,
                satoshisIn: 1700000n,
            });

            Assert.expect(getQuoteResult.price).toEqual(10n);
            Assert.expect(getQuoteResult.requiredSatoshis).toEqual(200000n);
            Assert.expect(getQuoteResult.tokensOut).toEqual(2000000n);
        },
    );
});
