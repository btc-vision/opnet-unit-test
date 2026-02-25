import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';

await opnet('NativeSwap – purge watermark invariants', async (vm: OPNetUnit) => {
    let swap: NativeSwap;
    let token: OP20;

    const deployer: Address = Blockchain.generateRandomAddress();
    const tokenAddr: Address = Blockchain.generateRandomAddress();
    const contractAddr: Address = Blockchain.generateRandomAddress();
    const lpReceiver: Address = Blockchain.generateRandomAddress();
    const tokenDec = 18;

    const TTL: bigint = BigInt(NativeSwap.RESERVATION_EXPIRE_AFTER);

    async function freshEnv(): Promise<void> {
        Blockchain.dispose();
        Blockchain.clearContracts();

        await Blockchain.init();
        Blockchain.blockNumber = 1n;

        token = new OP20({
            file: 'MyToken',
            deployer,
            address: tokenAddr,
            decimals: tokenDec,
        });
        Blockchain.register(token);

        await token.init();
        await token.mintRaw(deployer, Blockchain.expandToDecimal(1_000_000, tokenDec));

        swap = new NativeSwap(deployer, contractAddr);
        Blockchain.register(swap);
        await swap.init();

        const floorPrice = 10n ** 18n / 500n;
        const initialLiq = 52_500n * 10n ** BigInt(tokenDec);

        Blockchain.msgSender = deployer;
        Blockchain.txOrigin = deployer;
        await token.increaseAllowance(deployer, swap.address, initialLiq);

        await swap.setStakingContractAddress({
            stakingContractAddress: Blockchain.generateRandomAddress(),
        });

        await swap.createPool({
            token: tokenAddr,
            floorPrice,
            initialLiquidity: initialLiq,
            receiver: lpReceiver,
            network: Blockchain.network,
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 100,
        });

        Blockchain.blockNumber = 40n;
        await swap.purgeReservationsAndRestoreProviders(tokenAddr);

        const len = await swap.getBlocksWithReservationsLength(tokenAddr);
        Assert.expect(len).toEqual(0);
    }

    async function reserveN(n: number): Promise<void> {
        const sat = 12_345n;

        for (let i = 0; i < n; ++i) {
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = buyer;
            Blockchain.msgSender = buyer;

            await swap.reserve({
                token: tokenAddr,
                maximumAmountIn: sat,
                minimumAmountOut: 0n,
                activationDelay: 1,
            });
        }
    }

    async function warpAndTrigger(b: bigint) {
        Blockchain.blockNumber = b;
        await swap.purgeReservationsAndRestoreProviders(tokenAddr);
    }

    const queueLen = async () => await swap.getBlocksWithReservationsLength(tokenAddr);
    const watermark = async () => await swap.getLastPurgedBlock(tokenAddr);

    await vm.it('A) watermark advances after a full purge', async () => {
        await freshEnv();

        Blockchain.blockNumber = 1_000n;
        await reserveN(3);

        const frontier = 1_000n + TTL + 1n;
        await warpAndTrigger(frontier);

        const l = await queueLen();
        const water = await watermark();

        Assert.expect(l).toEqual(0);
        Assert.expect(water).toEqual(frontier - TTL);
    });

    await vm.it('B) watermark stays when head is too new', async () => {
        await freshEnv();

        Blockchain.blockNumber = 2_000n;
        await reserveN(2);

        const before = await watermark();

        await warpAndTrigger(2_000n + TTL - 1n);

        const l = await queueLen();
        const water = await watermark();

        Assert.expect(water).toEqual(before);
        Assert.expect(l).toEqual(1);
    });

    await vm.it('C) watermark advances only after block is fully cleared', async () => {
        await freshEnv();

        Blockchain.blockNumber = 3_000n;
        await reserveN(NativeSwap.PURGE_AT_LEAST_X_PROVIDERS + 5);

        const frontier = 3_000n + TTL + 1n;

        await warpAndTrigger(frontier);

        const l = await queueLen();
        Assert.expect(l).toEqual(1);

        const afterFirst = await watermark();
        Assert.expect(afterFirst).toBeLessThanOrEqual(frontier - TTL - 1n);

        await warpAndTrigger(frontier + 1n);

        const l2 = await queueLen();
        const water = await watermark();

        Assert.expect(l2).toEqual(0);
        Assert.expect(water).toEqual(frontier + 1n - TTL);
    });
});
