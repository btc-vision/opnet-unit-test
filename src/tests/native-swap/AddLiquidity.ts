import { Address } from '@btc-vision/transaction';
import { Blockchain, gas2USD, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient, ReserveResult } from '../../contracts/NativeSwapTypes.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { BitcoinUtils } from 'opnet';

/**
 * Here is our candle-chart style data,
 * using the same structure you provided: { x: number; y: number[] }.
 */
let dataNative: { x: number; y: number[] }[] = [];

let open = 0;

await opnet('Native Swap - Add Liquidity', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const point25InitialLiquidity = 52_500n * 10n ** BigInt(tokenDecimals);
    const initialLiquidity = 1_000_000n * 10n ** BigInt(tokenDecimals); //20_947_500n

    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    const floorPrice: bigint = 10n ** 18n / 1500n; //10n ** 18n;

    let toSwap: { a: Address; r: Recipient[] }[] = [];
    let toAddLiquidity: { a: Address; r: Recipient[] }[] = [];

    async function randomReserve(
        amount: bigint,
        forLP: boolean = false,
        rnd: boolean = true,
    ): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;

        let provider: Address = Blockchain.txOrigin;
        if (rnd) {
            provider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        const r = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: amount,
            minimumAmountOut: 0n,
            forLP: forLP,
            activationDelay: 0,
        });
        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            if (forLP) {
                toAddLiquidity.push({
                    a: provider,
                    r: decoded.recipients,
                });
            } else {
                toSwap.push({
                    a: provider,
                    r: decoded.recipients,
                });
            }
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

        vm.info(
            `Reserved ${BitcoinUtils.formatUnits(r.expectedAmountOut, tokenDecimals)} tokens for ${provider} with ${decoded.recipients.length} recipients, amount of sat requested: ${decoded.totalSatoshis}`,
        );

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
        return r;
    }

    async function listTokenRandom(
        l: bigint,
        provider: Address = Blockchain.generateRandomAddress(),
    ): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Transfer tokens from userAddress to provider
        await token.transfer(userAddress, provider, l);

        // Approve NativeSwap contract to spend tokens
        await token.approve(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: l,
            priority: false,
            disablePriorityQueueFees: false,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        vm.info(`Added liquidity for ${l} tokens`);
    }

    async function swapAll(): Promise<void> {
        for (let i = 0; i < toSwap.length; i++) {
            const reservation = toSwap[i];
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await nativeSwap.swap({ token: tokenAddress });
            const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                s.response.events[s.response.events.length - 1].data,
            );

            vm.log(
                `Swapped spent ${gas2USD(s.response.usedGas)} USD in gas, ${d.amountOut} tokens`,
            );
        }
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    async function reserveAddLiquidity(
        l: bigint,
        rnd: boolean = false,
        provider: Address = Blockchain.txOrigin,
    ): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;
        if (rnd) {
            provider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Transfer tokens from userAddress to provider
        await token.transfer(userAddress, provider, l);

        // Approve NativeSwap contract to spend tokens
        await token.approve(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const r = await randomReserve(l, true, false);
        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);

        vm.log(
            `Adding liquidity potentially worth ${decoded.totalSatoshis} sat and reserving ${decoded.recipients.length} recipients.`,
        );

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
        return r;

        //createRecipientsOutput(reservation.r);
    }

    async function addLiquidityRandom(): Promise<void> {
        for (let i = 0; i < toAddLiquidity.length; i++) {
            const reservation = toAddLiquidity[i];
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);

            await token.approve(
                reservation.a,
                nativeSwap.address,
                BitcoinUtils.expandToDecimals(1_000_000_000_000, tokenDecimals),
            );

            const s = await nativeSwap.addLiquidity({
                token: tokenAddress,
                receiver: reservation.a.p2tr(Blockchain.network),
            });

            const d = NativeSwapTypesCoders.decodeLiquidityAddedEvent(
                s.response.events[s.response.events.length - 1].data,
            );
            vm.log(
                `Added liquidity! Spent ${gas2USD(s.response.usedGas)} USD in gas, totalSatoshisSpent: ${d.totalSatoshisSpent}, totalTokensContributed: ${d.totalTokensContributed}, virtualTokenExchanged: ${d.virtualTokenExchanged}`,
            );
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toAddLiquidity = [];
    }

    async function removeLiquidity(p: Address): Promise<void> {
        const rn = Blockchain.txOrigin;

        Blockchain.txOrigin = p;
        Blockchain.msgSender = p;

        const r = await nativeSwap.removeLiquidity({ token: tokenAddress });
        const d = NativeSwapTypesCoders.decodeLiquidityRemovedEvent(
            r.response.events[r.response.events.length - 1].data,
        );

        vm.log(
            `Removed liquidity! Spent ${gas2USD(r.response.usedGas)} USD in gas, btcOwed: ${d.btcOwed} sat, tokenAmount: ${d.tokenAmount} tokens`,
        );

        Blockchain.txOrigin = rn;
        Blockchain.msgSender = rn;
    }

    /**
     * Helper: Create the NativeSwap pool with initial liquidity
     */
    async function createNativeSwapPool(floorPrice: bigint, initLiquidity: bigint): Promise<void> {
        // Approve NativeSwap to take tokens
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        await token.approve(userAddress, nativeSwap.address, initLiquidity);

        // Create the pool
        await nativeSwap.createPool({
            token: token.address,
            floorPrice: floorPrice,
            initialLiquidity: initLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 40,
        });

        Blockchain.blockNumber += 1n;

        const quote = await nativeSwap.getQuote({ token: token.address, satoshisIn: 100_000_000n });
        const amountIn = quote.requiredSatoshis;
        let price = quote.price;

        if (amountIn !== 100_000_000n) {
            price = (price * 100_000_000n) / amountIn;
        }

        const reversedPrice =
            1 / parseFloat(BitcoinUtils.formatUnits(price / quote.scale, tokenDecimals));

        recordCandle(
            Blockchain.blockNumber,
            reversedPrice, // raw bigint
            dataNative,
        );
    }

    async function reportQuote(): Promise<void> {
        const quote = await nativeSwap.getQuote({ token: token.address, satoshisIn: 100_000_000n });
        const amountIn = quote.requiredSatoshis;
        let price = quote.price;

        if (amountIn !== 100_000_000n) {
            price = (price * 100_000_000n) / amountIn;
        }

        const reversedPrice =
            1 / parseFloat(BitcoinUtils.formatUnits(price / quote.scale, tokenDecimals));

        // Also record a candle in `data`
        // We'll do the same logic as your snippet: parse the price to float, etc.
        recordCandle(
            Blockchain.blockNumber,
            reversedPrice, // raw bigint
            dataNative,
        );
    }

    vm.beforeEach(async () => {
        dataNative = [
            {
                x: 1,
                y: [0, 0, 0, 0],
            },
        ];
        toSwap = [];
        open = 0;
        toAddLiquidity = [];

        Blockchain.blockNumber = 1n;

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
        const totalSupply = Blockchain.expandToDecimal(1_000_000_000_000, tokenDecimals);
        await token.mintRaw(userAddress, totalSupply);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await createNativeSwapPool(floorPrice, point25InitialLiquidity);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should add some liquidity1', async () => {
        Blockchain.tracePointers = false;

        const rndProvider = Blockchain.generateRandomAddress();

        await token.transfer(
            userAddress,
            rndProvider,
            BitcoinUtils.expandToDecimals(100_000_000_000, tokenDecimals),
        );

        for (let i = 0; i < 25; i++) {
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));
        }

        const buyForSat = 20_000_000n;
        await reserveAddLiquidity(buyForSat, false, rndProvider);

        Blockchain.blockNumber += 1n;

        await reportQuote();
        await addLiquidityRandom();

        await listTokenRandom(BitcoinUtils.expandToDecimals(1_000, tokenDecimals));

        await reserveAddLiquidity(buyForSat, false, rndProvider);

        Blockchain.blockNumber += 2n;

        await reportQuote();

        await addLiquidityRandom();

        await removeLiquidity(rndProvider);

        //await listTokenRandom(BitcoinUtils.expandToDecimals(1_000, tokenDecimals), rndProvider);

        let rndProvider2 = Blockchain.generateRandomAddress();

        await token.transfer(
            rndProvider,
            rndProvider2,
            BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
        );

        for (let i = 0; i < 25; i++) {
            await listTokenRandom(BitcoinUtils.expandToDecimals(10000, tokenDecimals));
        }

        await reserveAddLiquidity(buyForSat * 100n, false, rndProvider2);

        Blockchain.blockNumber += 2n;

        await reportQuote();

        await addLiquidityRandom();

        rndProvider2 = Blockchain.generateRandomAddress();

        await token.transfer(
            userAddress,
            rndProvider2,
            BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
        );

        for (let i = 0; i < 25; i++) {
            await listTokenRandom(BitcoinUtils.expandToDecimals(10000, tokenDecimals));
        }

        await reserveAddLiquidity(buyForSat * 100n, false, rndProvider2);

        Blockchain.blockNumber += 2n;

        await reportQuote();

        await addLiquidityRandom();

        Blockchain.tracePointers = false;

        await randomReserve(100_000_000n, false, true);

        Blockchain.blockNumber += 2n;

        await reportQuote();

        await swapAll();

        Blockchain.blockNumber += 2n;

        await reportQuote();

        console.log(`Data: ${JSON.stringify(dataNative)}`);
    });

    const buyForSat = 20_000_000n;
    await vm.it('should add some liquidity2', async () => {
        for (let i = 0; i < 25; i++) {
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));
        }

        for (let i = 0; i < 20; i++) {
            const rndProvider = Blockchain.generateRandomAddress();

            await token.transfer(
                userAddress,
                rndProvider,
                BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
            );

            console.log('start');
            const r = await reserveAddLiquidity(buyForSat * BigInt(i + 1), false, rndProvider);

            Blockchain.blockNumber += 1n;

            await reportQuote();

            if (r.expectedAmountOut !== 0n) {
                await addLiquidityRandom();
                await removeLiquidity(rndProvider);
            }

            await randomReserve(buyForSat, false, true);

            Blockchain.blockNumber += 1n;

            await reportQuote();

            await swapAll();

            Blockchain.blockNumber += 1n;

            await reportQuote();
        }

        console.log(`Data 2: ${JSON.stringify(dataNative)}`);
    });

    await vm.it('should add some liquidity3', async () => {
        for (let i = 0; i < 25; i++) {
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));
        }

        for (let i = 0; i < 20; i++) {
            const rndProvider = Blockchain.generateRandomAddress();

            await token.transfer(
                userAddress,
                rndProvider,
                BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
            );

            await randomReserve(buyForSat, false, true);

            Blockchain.blockNumber += 1n;

            await reportQuote();

            await swapAll();

            Blockchain.blockNumber += 1n;

            await reportQuote();
        }

        console.log(`Data 3: ${JSON.stringify(dataNative)}`);
    });

    /**
     * Candle-style logger. Mimics your "logPrice()" example,
     * pushing data into the global `data` array with shape
     * { x: blockNumber, y: [-open, -open, -close, -close] }.
     */
    function recordCandle(
        blockNumber: bigint,
        closeFloat: number,
        store: { x: number; y: number[] }[],
    ) {
        if (open !== 0) {
            store.push({
                x: Number(blockNumber.toString()),
                y: [open, open, closeFloat, closeFloat],
            });
        } else {
            store.push({
                x: Number(blockNumber.toString()),
                y: [closeFloat, closeFloat, closeFloat, closeFloat],
            });
        }

        // Update open to be the new close
        open = closeFloat;
    }
});
