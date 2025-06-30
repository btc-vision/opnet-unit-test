import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { helper_createToken } from '../utils/OperationHelper.js';

await opnet('Native Swap - Get Reserve', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    async function createDefaultLiquidityPool(): Promise<void> {
        Blockchain.blockNumber = 1000n;
        const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
        const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.approve(userAddress, nativeSwap.address, liquidityAmount);

        const quote = await nativeSwap.createPool({
            token: token.address,
            floorPrice: 100n,
            initialLiquidity: 25000000n,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 40,
        });

        Assert.expect(quote.result).toEqual(true);
    }

    async function randomReserve(amount: bigint, rnd: boolean = true): Promise<void> {
        const backup = Blockchain.txOrigin;

        let provider: Address = Blockchain.txOrigin;
        if (rnd) {
            provider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        const r = await nativeSwap.reserve({
            token: token.address,
            maximumAmountIn: amount,
            minimumAmountOut: 0n,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
    }

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(userAddress, tokenDecimals, 10_000_000);

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
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
            await nativeSwap.getReserve({
                token: new Address(),
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);

        await Assert.expect(async () => {
            await nativeSwap.getReserve({
                token: Blockchain.DEAD_ADDRESS,
            });
        }).toThrow(`NATIVE_SWAP: Invalid token address`);
    });

    await vm.it('should revert when no pool created', async () => {
        await Assert.expect(async () => {
            await nativeSwap.getReserve({
                token: token.address,
            });
        }).toThrow(`NATIVE_SWAP: Pool does not exist for token`);

        await Assert.expect(async () => {
            await nativeSwap.getReserve({
                token: Blockchain.generateRandomAddress(),
            });
        }).toThrow(`NATIVE_SWAP: Pool does not exist for token`);
    });

    await vm.it('should get valid reserve values when pool exists and no reservation', async () => {
        await createDefaultLiquidityPool();

        const reserveResult = await nativeSwap.getReserve({
            token: token.address,
        });

        Blockchain.log(`Liquidity: ${reserveResult.liquidity}`);
        Blockchain.log(`ReservedLiquidity: ${reserveResult.reservedLiquidity}`);
        Blockchain.log(`VirtualBTCReserve: ${reserveResult.virtualBTCReserve}`);
        Blockchain.log(`VirtualTokenReserve: ${reserveResult.virtualTokenReserve}`);

        Assert.expect(reserveResult.liquidity).toEqual(25000000n);
        Assert.expect(reserveResult.reservedLiquidity).toEqual(0n);
        Assert.expect(reserveResult.virtualBTCReserve).toEqual(250000n);
        Assert.expect(reserveResult.virtualTokenReserve).toEqual(25000000n);
    });

    await vm.it('should get valid reserve values when pool exists and reservation', async () => {
        await createDefaultLiquidityPool();
        await randomReserve(10000n);

        const reserveResult = await nativeSwap.getReserve({
            token: token.address,
        });

        Assert.expect(reserveResult.liquidity).toEqual(25000000n);
        Assert.expect(reserveResult.reservedLiquidity).toEqual(1000000n);
        Assert.expect(reserveResult.virtualBTCReserve).toEqual(250000n);
        Assert.expect(reserveResult.virtualTokenReserve).toEqual(25000000n);
    });
});
