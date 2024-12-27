import { Address } from '@btc-vision/transaction';
import { Blockchain, CallResponse, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';

import { NativeSwap, Recipient } from '../../contracts/ewma/NativeSwap.js';
import { MotoswapRouter } from '../../contracts/motoswap/MotoswapRouter.js';
import { MotoswapFactory } from '../../contracts/motoswap/MotoswapFactory.js';
import { MotoswapPool } from '../../contracts/motoswap/MotoswapPool.js';
import { createRecipientsOutput, gas2USD } from '../orderbook/utils/OrderBookUtils.js';
import { WBTC_ADDRESS } from '../../common.js';
import { getReserves } from '../../common/UtilFunctions.js';
import { BitcoinUtils } from 'opnet';

// Same constants from your example
const tokenDecimals = 18;
const initialLiquidity = 500_000_000n * 10n ** BigInt(tokenDecimals);
const satoshisIn = 1_000_000n; // 0.01 BTC
const userAddress: Address = Blockchain.generateRandomAddress();
const tokenAddress: Address = Blockchain.generateRandomAddress();
const ewmaAddress: Address = Blockchain.generateRandomAddress();
const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

// For Motoswap
const dttAddress: Address = tokenAddress; // we'll treat it as “DTT” in the normal swap scenario
const receiver: Address = userAddress;
const MaxUint256: bigint = 2n ** 256n - 1n;

// We'll track logs in two separate arrays
const nativeSwapPriceData: { block: number; currentPrice: bigint }[] = [];
const motoswapPriceData: { block: number; currentPrice: bigint }[] = [];

let toSwap: { a: Address; r: Recipient[] }[] = [];

/**
 * Here is our candle-chart style data,
 * using the same structure you provided: { x: number; y: number[] }.
 */
const data: { x: number; y: number[] }[] = [];
const dataNative: { x: number; y: number[] }[] = [];

let open = 0;

await opnet('Compare NativeSwap vs Normal OP20 Swap', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let myToken: OP_20;
    let wbtc: OP_20;
    let motoswapFactory: MotoswapFactory;
    let motoswapPool: MotoswapPool;
    let motoswapRouter: MotoswapRouter;

    let poolAddy: Address;

    /**
     * Pre-test hooks
     */
    vm.beforeEach(async () => {
        // For demonstration, reset everything each time
        Blockchain.blockNumber = 1n;
        Blockchain.clearContracts();
        Blockchain.dispose();

        open = 0;

        // Deploy OP_20 token that both scenarios will share
        myToken = new OP_20({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });
        Blockchain.register(myToken);

        // ========== NATIVESWAP SETUP ==========
        nativeSwap = new NativeSwap(userAddress, ewmaAddress, 500_000_000_000n);
        Blockchain.register(nativeSwap);

        // ========== MOTOSWAP SETUP ==========
        // 1) Factory
        motoswapFactory = new MotoswapFactory(Blockchain.txOrigin);
        Blockchain.register(motoswapFactory);

        // 2) Template pool
        motoswapPool = new MotoswapPool(tokenAddress, WBTC_ADDRESS);
        Blockchain.register(motoswapPool);

        // 3) Router
        motoswapRouter = new MotoswapRouter(Blockchain.txOrigin);
        Blockchain.register(motoswapRouter);

        // 4) Mock WBTC
        wbtc = new OP_20({
            file: 'MyToken',
            deployer: receiver,
            address: WBTC_ADDRESS,
            decimals: 8, // If you want it to be real-like WBTC
        });
        Blockchain.register(wbtc);

        await Blockchain.init();

        // Mint enough supply for scenario
        const totalSupply = Blockchain.expandToDecimal(1_000_000_000_000, tokenDecimals);
        await myToken.mintRaw(userAddress, totalSupply);

        // Pre-create pool in NativeSwap, adding initial liquidity:
        // We'll just pick some big “floorPrice” for demonstration, e.g. 1 token per sat
        const floorPrice: bigint = 10n ** 18n;
        await createNativeSwapPool(floorPrice, initialLiquidity);

        // For Motoswap, we do a ratio that tries to mirror the “floorPrice” ratio:
        //   tokenA = WBTC, tokenB = myToken
        // If floorPrice is 1 token per sat, and we have “satoshisIn=1M” => 1M tokens needed for 1M sat.
        // But let's keep it simple. If we do initialLiquidity / floorPrice for WBTC
        // and initialLiquidity for myToken, we effectively produce that ratio.
        await addMotoswapLiquidity(initialLiquidity / floorPrice, initialLiquidity);
    });

    vm.afterEach(() => {
        // Cleanup
        nativeSwap.dispose();
        myToken.dispose();
        motoswapFactory.dispose();
        motoswapPool.dispose();
        motoswapRouter.dispose();
        wbtc.dispose();
        Blockchain.dispose();
    });

    /**
     * This is where the main test is done.
     */
    await vm.it('should run the same swaps on both NativeSwap & Motoswap', async () => {
        // 1) Make 3 consecutive swaps with the same parameters on NativeSwap
        await runNativeSwapScenario(25);
    });

    await vm.it('compare with Motoswap', async () => {
        await runMotoswapScenario(25);

        vm.debug('\n===== Candle Data Motoswap Native =====');
        console.log(JSON.stringify(dataNative));

        vm.debug('\n===== Candle Data Motoswap OP20 =====');
        console.log(JSON.stringify(data));

        vm.debug('\n===== NativeSwap Data =====');
        console.log(JSON.stringify(nativeSwapPriceData));

        vm.debug('\n===== Motoswap Data =====');
        console.log(JSON.stringify(motoswapPriceData));

        // Optionally compare final prices
        if (nativeSwapPriceData.length && motoswapPriceData.length) {
            const nativeLast = nativeSwapPriceData[nativeSwapPriceData.length - 1].currentPrice;
            const motoLast = motoswapPriceData[motoswapPriceData.length - 1].currentPrice;

            vm.debug(`\nNativeSwap final price:  ${nativeLast.toString()}`);
            vm.debug(`Motoswap final price:     ${motoLast.toString()}`);
        }
    });

    /**
     * Helper: Create the NativeSwap pool with initial liquidity
     */
    async function createNativeSwapPool(floorPrice: bigint, initLiquidity: bigint): Promise<void> {
        // Approve NativeSwap to take tokens
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        await myToken.approve(userAddress, nativeSwap.address, initLiquidity);

        // Create the pool
        await nativeSwap.createPool(
            myToken.address,
            floorPrice,
            initLiquidity,
            initialLiquidityProvider.p2tr(Blockchain.network),
            0,
            0n,
        );
    }

    /**
     * Helper: Add Motoswap liquidity
     */
    async function addMotoswapLiquidity(tokenAAmount: bigint, tokenBAmount: bigint) {
        // Approve tokens for router
        await myToken.approve(receiver, motoswapRouter.address, tokenBAmount);

        await wbtc.mintRaw(receiver, tokenAAmount);
        await wbtc.approve(receiver, motoswapRouter.address, tokenAAmount);

        const addLiquidity = await motoswapRouter.addLiquidity({
            tokenA: WBTC_ADDRESS,
            tokenB: dttAddress,
            amountADesired: tokenAAmount,
            amountBDesired: tokenBAmount,
            amountAMin: 0n,
            amountBMin: 0n,
            to: receiver,
            deadline: 9999999999n,
        });

        // The second event is typically the first Transfer event for pool tokens
        const transferEventA = addLiquidity.events[1];
        const poolCreatedEvent = MotoswapPool.decodeTransferEvent(transferEventA.data);
        poolAddy = poolCreatedEvent.to;

        vm.info(`Pool created at ${poolAddy}`);
    }

    async function addLiquidityRandom(l: bigint): Promise<void> {
        const provider = Blockchain.generateRandomAddress();

        // Transfer tokens from userAddress to provider
        await myToken.transfer(userAddress, provider, l);

        // Approve EWMA contract to spend tokens
        await myToken.approve(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;
        await nativeSwap.addLiquidity(tokenAddress, provider.p2tr(Blockchain.network), l);

        vm.info(`Added liquidity for ${l} tokens`);
    }

    async function randomReserve(
        amount: bigint,
    ): Promise<{ result: bigint; response: CallResponse }> {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const r = await nativeSwap.reserve(tokenAddress, amount, 1n);
        const decoded = nativeSwap.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            toSwap.push({
                a: provider,
                r: decoded.recipients,
            });
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

        // Reset
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        return r;
    }

    async function swapAll(): Promise<void> {
        for (let i = 0; i < toSwap.length; i++) {
            const reservation = toSwap[i];
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await nativeSwap.swap(tokenAddress, false);
            vm.log(`Swapped spent ${gas2USD(s.response.usedGas)} USD in gas`);
        }
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    /**
     * Run a few “swaps” on NativeSwap (reserve -> swap).
     * We track the price after each swap in nativeSwapPriceData,
     * AND also record a candle point in `data`.
     */
    async function runNativeSwapScenario(count: number) {
        for (let i = 0; i < count; i++) {
            const randomProvider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = randomProvider;
            Blockchain.msgSender = randomProvider;

            for (let y = 0; y < 5; y++) {
                await randomReserve(satoshisIn);
            }

            // Advance the chain
            Blockchain.blockNumber += 1n;

            await swapAll();

            const quote = await nativeSwap.getQuote(myToken.address, satoshisIn);
            const price = quote.result.currentPrice;

            // Log data in the old array
            nativeSwapPriceData.push({
                block: Number(Blockchain.blockNumber.toString()),
                currentPrice: price,
            });

            // Also record a candle in `data`
            // We'll do the same logic as your snippet: parse the price to float, etc.
            recordCandle(
                Blockchain.blockNumber,
                price, // raw bigint
                dataNative,
            );
        }

        for (let i = 0; i < count; i++) {
            const randomProvider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = randomProvider;
            Blockchain.msgSender = randomProvider;

            for (let y = 0; y < 5; y++) {
                // Advance the chain
                const quote = await nativeSwap.getQuote(myToken.address, satoshisIn);
                const price = quote.result.currentPrice;

                await addLiquidityRandom(satoshisIn * price);
            }

            if (i + 1 === count) {
                await addLiquidityRandom(initialLiquidity);
            }

            Blockchain.blockNumber += 1n;

            const quote2 = await nativeSwap.getQuote(myToken.address, satoshisIn);
            const price2 = quote2.result.currentPrice;

            // Log data in the old array
            nativeSwapPriceData.push({
                block: Number(Blockchain.blockNumber.toString()),
                currentPrice: price2,
            });

            // Also record a candle in `data`
            // We'll do the same logic as your snippet: parse the price to float, etc.
            recordCandle(
                Blockchain.blockNumber,
                price2, // raw bigint
                dataNative,
            );
        }

        // Reset
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    }

    /**
     * Run a few “swaps” on Motoswap (swapExactTokensForTokens).
     * We track the price after each swap in motoswapPriceData,
     * AND also record a candle point in `data`.
     */
    async function runMotoswapScenario(count: number) {
        const wbtcIn = satoshisIn;

        // Mint enough wbtc for each swap
        await wbtc.mintRaw(receiver, wbtcIn * BigInt(count + 1) * 5n);
        await wbtc.approve(receiver, motoswapRouter.address, MaxUint256);

        await myToken.approve(receiver, motoswapRouter.address, MaxUint256);

        const path = [WBTC_ADDRESS, tokenAddress];

        // Buy Side
        for (let i = 0; i < count; i++) {
            Blockchain.txOrigin = receiver;
            Blockchain.msgSender = receiver;

            for (let x = 0; x < 5; x++) {
                // do the swap
                const swap =
                    await motoswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                        wbtcIn,
                        0n,
                        path,
                        receiver,
                        9999999999n,
                    );

                const swapped = MotoswapPool.decodeSwapEvent(
                    swap.events[swap.events.length - 1].data,
                );

                const usedGasInUSD = gas2USD(swap.usedGas);
                vm.debug(
                    `Motoswap swapped, spent approx. ${usedGasInUSD} USD in gas. Swapped: ${swapped.amount1Out || swapped.amount0Out}`,
                );
            }

            // Advance block
            Blockchain.blockNumber += 1n;

            const pairContract = MotoswapPool.createFromRuntime(
                Blockchain.getContract(poolAddy),
                WBTC_ADDRESS,
                tokenAddress,
            );

            await pairContract.init();

            // read new reserves
            const [reserve0, reserve1] = [
                await pairContract.reserve0(),
                await pairContract.reserve1(),
            ];

            // sort them so we interpret them correctly
            const r = getReserves(WBTC_ADDRESS, tokenAddress, reserve0, reserve1);

            // currentPrice = how many myToken we get for `satoshisIn` WBTC
            const currentPrice = await motoswapRouter.quote(wbtcIn, r.reserve0, r.reserve1);
            const tokenPerSat = currentPrice / satoshisIn;

            motoswapPriceData.push({
                block: Number(Blockchain.blockNumber.toString()),
                currentPrice: tokenPerSat,
            });

            // record a candle
            recordCandle(Blockchain.blockNumber, tokenPerSat, data);

            pairContract.dispose();
        }

        const p = path.reverse();

        // Sell side
        for (let i = 0; i < count; i++) {
            Blockchain.txOrigin = receiver;
            Blockchain.msgSender = receiver;

            for (let x = 0; x < 5; x++) {
                const pairContract = MotoswapPool.createFromRuntime(
                    Blockchain.getContract(poolAddy),
                    WBTC_ADDRESS,
                    tokenAddress,
                );

                await pairContract.init();

                // read new reserves
                const [reserve0, reserve1] = [
                    await pairContract.reserve0(),
                    await pairContract.reserve1(),
                ];

                // sort them so we interpret them correctly
                const r = getReserves(WBTC_ADDRESS, tokenAddress, reserve0, reserve1);
                const currentPrice = await motoswapRouter.quote(wbtcIn, r.reserve0, r.reserve1);

                // do the swap
                const swap =
                    await motoswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                        currentPrice,
                        0n,
                        p,
                        receiver,
                        9999999999n,
                    );

                const swapped = MotoswapPool.decodeSwapEvent(
                    swap.events[swap.events.length - 1].data,
                );

                const usedGasInUSD = gas2USD(swap.usedGas);
                vm.debug(
                    `Motoswap swapped, spent approx. ${usedGasInUSD} USD in gas. Swapped: ${swapped.amount1Out || swapped.amount0Out}, swapped: ${currentPrice}`,
                );

                pairContract.dispose();
            }

            if (i + 1 === count) {
                await myToken.mintRaw(receiver, initialLiquidity);

                const swap =
                    await motoswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                        initialLiquidity,
                        0n,
                        p,
                        receiver,
                        9999999999n,
                    );

                const swapped = MotoswapPool.decodeSwapEvent(
                    swap.events[swap.events.length - 1].data,
                );

                const usedGasInUSD = gas2USD(swap.usedGas);
                vm.debug(
                    `Motoswap swapped, spent approx. ${usedGasInUSD} USD in gas. Swapped: ${swapped.amount1Out || swapped.amount0Out}, swapped: ${initialLiquidity}`,
                );
            }

            // Advance block
            Blockchain.blockNumber += 1n;

            const pairContract = MotoswapPool.createFromRuntime(
                Blockchain.getContract(poolAddy),
                WBTC_ADDRESS,
                tokenAddress,
            );

            await pairContract.init();

            // read new reserves
            const [reserve0, reserve1] = [
                await pairContract.reserve0(),
                await pairContract.reserve1(),
            ];

            // sort them so we interpret them correctly
            const r = getReserves(WBTC_ADDRESS, tokenAddress, reserve0, reserve1);

            // currentPrice = how many myToken we get for `satoshisIn` WBTC
            const currentPrice = await motoswapRouter.quote(wbtcIn, r.reserve0, r.reserve1);
            const tokenPerSat = currentPrice / wbtcIn;

            motoswapPriceData.push({
                block: Number(Blockchain.blockNumber.toString()),
                currentPrice: tokenPerSat,
            });

            pairContract.dispose();

            // record a candle
            recordCandle(Blockchain.blockNumber, tokenPerSat, data);
        }

        // reset
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    }

    /**
     * Candle-style logger. Mimics your "logPrice()" example,
     * pushing data into the global `data` array with shape
     * { x: blockNumber, y: [-open, -open, -close, -close] }.
     */
    function recordCandle(
        blockNumber: bigint,
        rawPrice: bigint,
        store: { x: number; y: number[] }[],
    ) {
        // Convert price from `bigint` to a float, similar to your snippet with formatUnits
        const closeFloat = parseFloat(BitcoinUtils.formatUnits(rawPrice, tokenDecimals));

        // You had a condition about blockNumber === 2500n. We can replicate that if needed:
        if (blockNumber === 2500n) return;

        if (open !== 0) {
            store.push({
                x: Number(blockNumber.toString()),
                y: [-open, -open, -closeFloat, -closeFloat],
            });
        }

        // Update open to be the new close
        open = closeFloat;
    }
});
