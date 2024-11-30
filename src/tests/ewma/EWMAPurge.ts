import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    CallResponse,
    OP_20,
    opnet,
    OPNetUnit,
} from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';
import { gas2BTC, gas2Sat, gas2USD } from '../orderbook/utils/OrderBookUtils.js';
import { BitcoinUtils } from 'opnet';

await opnet('EWMA Contract - getQuote Method Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(10_000, tokenDecimals);
    const satoshisPrice: bigint = 400_000n; // 0.001 BTC
    const price: bigint = Blockchain.expandToDecimal(100, tokenDecimals) / satoshisPrice;

    const satoshisIn: bigint = 1_000_000n; // 0.001 BTC

    const minimumAmountOut: bigint = Blockchain.expandToDecimal(10, tokenDecimals); // Minimum 10 tokens
    const slippage: number = 100; // 1%

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
        await token.mint(userAddress, 100_000_000); // Ensure this is bigint

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress, 350_000_000_000n);
        Blockchain.register(ewma);
        await ewma.init();

        // Add liquidity
        //await addLiquidityRandom();
    });

    vm.afterEach(() => {
        ewma.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    /**
     * Helper function to add liquidity from a random provider.
     */
    async function addLiquidityRandom(l: bigint = liquidityAmount): Promise<void> {
        const provider = Blockchain.generateRandomAddress();

        // Transfer tokens to the provider
        await token.transfer(userAddress, provider, l);

        // Provider approves the EWMA contract to spend tokens
        await token.approve(provider, ewma.address, l);

        // Provider adds liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;
        await ewma.addLiquidity(
            tokenAddress,
            provider.p2tr(Blockchain.network),
            l, // Assuming maximumAmountIn is liquidityAmount
        );
    }

    /**
     * Helper function to set the base price (p0) in the EWMA contract.
     * @param p0 - Base price in satoshis, scaled by ewma.p0ScalingFactor.
     */
    async function setQuote(p0: bigint): Promise<void> {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        const quote = await ewma.setQuote(tokenAddress, p0);

        vm.debug(
            `Quote set! Gas cost: ${gas2Sat(quote.usedGas)} sat (${gas2BTC(quote.usedGas)} BTC, $${gas2USD(quote.usedGas)})`,
        );
    }

    /**
     * Helper function to simulate block progression and update EWMA_L and EWMA_V.
     * @param blocks - Number of blocks to advance.
     */
    async function simulateBlocks(blocks: bigint): Promise<void> {
        for (let i = 0n; i < blocks; i++) {
            Blockchain.blockNumber += 1n;
            // Optionally, perform actions that would trigger EWMA updates
        }

        await Promise.resolve();
    }

    async function logPrice(): Promise<void> {
        const zeroQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `(Block ${Blockchain.blockNumber}) New price: ${BitcoinUtils.formatUnits(zeroQuote.result.currentPrice, tokenDecimals)} token per sat, ${BitcoinUtils.formatUnits(zeroQuote.result.expectedAmountOut, tokenDecimals)} tokens, sat spent: ${zeroQuote.result.expectedAmountIn}, cost ${gas2USD(zeroQuote.response.usedGas)}`,
        );
    }

    async function randomReserve(
        amount: bigint,
    ): Promise<{ result: bigint; response: CallResponse }> {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const r = await ewma.reserveTicks(tokenAddress, amount, minimumAmountOut);

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        return r;
    }

    await vm.it('should be able to quote and reserve and affect the price', async () => {
        // Set base price p0 = 1,000 satoshis (scaled by ewma.p0ScalingFactor = 10,000)
        Blockchain.log(`P0 is ${price}`);
        await setQuote(price);

        const initialQuote = await ewma.getQuote(tokenAddress, satoshisIn);
        vm.debug(
            `Initial Price: ${initialQuote.result.currentPrice}, Quote: ${initialQuote.result.expectedAmountOut.toString()} tokens, ${initialQuote.result.expectedAmountIn.toString()} satoshis`,
        );

        await logPrice();

        let l = 0;
        for (let i = 0; i < 500; i++) {
            l += 30;
            await addLiquidityRandom(BitcoinUtils.expandToDecimals(30, tokenDecimals));
        }

        await simulateBlocks(1n);
        await logPrice();

        let totalSpent: bigint = 0n;
        let t: bigint = 0n;
        for (let i = 0; i < 100; i++) {
            const took = Date.now();
            const r = await randomReserve(500_000n);
            t += r.result;
            totalSpent += r.response.usedGas;
            console.log(r.result, t, Date.now() - took);
        }
        await simulateBlocks(1n);
        for (let i = 0; i < 2; i++) {
            const r = await randomReserve(5_000_000n);
            t += r.result;
            totalSpent += r.response.usedGas;
            console.log(r.result, t);
        }
        await simulateBlocks(100n);

        console.log(
            `Spent in gas: ${gas2BTC(totalSpent)} BTC - ${gas2USD(totalSpent)} USD to reserve 500 providers on 100 reservations`,
        );

        await logPrice();
        const r = await ewma.reserveTicks(tokenAddress, satoshisIn, minimumAmountOut);
        //t += r.result;
        console.log(
            `Cost in gas: ${gas2BTC(r.response.usedGas)} BTC - ${gas2USD(r.response.usedGas)} USD`,
        );

        const total = BitcoinUtils.expandToDecimals(l, tokenDecimals);
        Assert.expect(t).toEqual(total - (total * 3n) / 100n);

        const r2 = await randomReserve(5_000_000n);
        console.log(
            `Cost in gas: ${gas2BTC(r2.response.usedGas)} BTC - ${gas2USD(r2.response.usedGas)} USD`,
        );

        //Blockchain.tracePointers = true;
        await logPrice();
        //Blockchain.tracePointers = false;
    });
});
