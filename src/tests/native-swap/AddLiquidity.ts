import { Address } from '@btc-vision/transaction';
import { Blockchain, CallResponse, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap, Recipient } from '../../contracts/ewma/NativeSwap.js';
import { createRecipientsOutput, gas2USD } from '../utils/TransactionUtils.js';
import { BitcoinUtils } from 'opnet';

await opnet('Native Swap - Add Liquidity', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const point25InitialLiquidity = 52_500n * 10n ** BigInt(tokenDecimals);
    const initialLiquidity = 1_000_000n * 10n ** BigInt(tokenDecimals); //20_947_500n

    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    const floorPrice: bigint = 666666666667000n; //10n ** 18n;

    let toSwap: { a: Address; r: Recipient[] }[] = [];
    let toAddLiquidity: { a: Address; r: Recipient[] }[] = [];

    async function randomReserve(
        amount: bigint,
        forLP: boolean = false,
        rnd: boolean = true,
    ): Promise<{ result: bigint; response: CallResponse }> {
        const backup = Blockchain.txOrigin;

        let provider: Address = Blockchain.txOrigin;
        if (rnd) {
            provider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        const r = await nativeSwap.reserve(tokenAddress, amount, 1n, forLP);
        const decoded = nativeSwap.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            toSwap.push({
                a: provider,
                r: decoded.recipients,
            });
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

        vm.info(
            `Reserved ${BitcoinUtils.formatUnits(r.result, tokenDecimals)} tokens for ${provider} with ${decoded.recipients.length} recipients, amount of sat requested: ${decoded.totalSatoshis}`,
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

        // Approve EWMA contract to spend tokens
        await token.approve(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await nativeSwap.listLiquidity(tokenAddress, provider.p2tr(Blockchain.network), l);

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
            const s = await nativeSwap.swap(tokenAddress, false);
            const d = NativeSwap.decodeSwapExecutedEvent(
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
    ): Promise<{
        result: bigint;
        response: CallResponse;
    }> {
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

        // Approve EWMA contract to spend tokens
        await token.approve(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const r = await randomReserve(l, true, false);
        const decoded = nativeSwap.decodeReservationEvents(r.response.events);

        vm.log(
            `Adding liquidity potentially worth ${decoded.totalSatoshis} sat and reserving ${decoded.recipients.length} recipients.`,
        );

        console.log(decoded.recipients);

        if (decoded.recipients.length) {
            toAddLiquidity.push({
                a: provider,
                r: decoded.recipients,
            });
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

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

            const s = await nativeSwap.addLiquidity(
                tokenAddress,
                reservation.a.p2tr(Blockchain.network),
            );

            const d = NativeSwap.decodeLiquidityAddedEvent(s.events[s.events.length - 1].data);
            vm.log(
                `Added liquidity! Spent ${gas2USD(s.usedGas)} USD in gas, totalSatoshisSpent: ${d.totalSatoshisSpent}, totalTokensContributed: ${d.totalTokensContributed}, virtualTokenExchanged: ${d.virtualTokenExchanged}`,
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

        const r = await nativeSwap.removeLiquidity(tokenAddress);
        const d = NativeSwap.decodeRemoveLiquidityEvent(
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
        await nativeSwap.createPool(
            token.address,
            floorPrice,
            initLiquidity,
            initialLiquidityProvider.p2tr(Blockchain.network),
            0,
            0n,
        );

        Blockchain.blockNumber += 1n;

        //recordCandle(
        //    Blockchain.blockNumber,
        //    floorPrice, // raw bigint
        //    dataNative,
        //);
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
        const totalSupply = Blockchain.expandToDecimal(1_000_000_000_000, tokenDecimals);
        await token.mintRaw(userAddress, totalSupply);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
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

    await vm.it('should add some liquidity', async () => {
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

        await addLiquidityRandom();

        await listTokenRandom(BitcoinUtils.expandToDecimals(1_000, tokenDecimals));

        await reserveAddLiquidity(buyForSat, false, rndProvider);

        Blockchain.blockNumber += 1n;

        await addLiquidityRandom();

        await removeLiquidity(rndProvider);

        await listTokenRandom(BitcoinUtils.expandToDecimals(1_000, tokenDecimals), rndProvider);

        const rndProvider2 = Blockchain.generateRandomAddress();

        console.log('hi');

        await token.transfer(
            rndProvider,
            rndProvider2,
            BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
        );

        //for (let i = 0; i < 25; i++) {
        //     await listTokenRandom(BitcoinUtils.expandToDecimals(10000, tokenDecimals));
        //}

        await reserveAddLiquidity(buyForSat * 100n, false, rndProvider2);

        Blockchain.blockNumber += 1n;

        await addLiquidityRandom();

        /*rndProvider = Blockchain.generateRandomAddress();

        await token.transfer(
            userAddress,
            rndProvider,
            BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
        );

        for (let i = 0; i < 25; i++) {
            await listTokenRandom(BitcoinUtils.expandToDecimals(10000, tokenDecimals));
        }

        await reserveAddLiquidity(buyForSat * 100n, false, rndProvider);

        Blockchain.blockNumber += 1n;

        await addLiquidityRandom();*/

        Blockchain.tracePointers = false;
    });
});
