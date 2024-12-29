import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';

await opnet('NativeSwap: Purging Reservations', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();
    const tokenDecimals = 18;

    async function createPool(
        floorPrice: bigint,
        initialLiquidity: bigint,
        antiBotEnabledFor: number = 0,
        antiBotMaximumTokensPerReservation: bigint = 0n,
    ): Promise<void> {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.mintRaw(userAddress, initialLiquidity);
        await token.approve(userAddress, nativeSwap.address, initialLiquidity);

        await nativeSwap.createPool(
            tokenAddress,
            floorPrice,
            initialLiquidity,
            initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
        );
    }

    async function addProviderLiquidity(
        amountIn: bigint,
        priority: boolean = false,
    ): Promise<Address> {
        const provider = Blockchain.generateRandomAddress();
        await token.mintRaw(provider, amountIn);
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;
        await token.approve(provider, nativeSwap.address, amountIn);
        const resp = await nativeSwap.listLiquidity(
            tokenAddress,
            provider.p2tr(Blockchain.network),
            amountIn,
            priority,
        );
        Assert.expect(resp.error).toBeUndefined();
        return provider;
    }

    async function makeReservation(buyer: Address, satIn: bigint, minOut: bigint): Promise<void> {
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const resp = await nativeSwap.reserve(tokenAddress, satIn, minOut);
        Assert.expect(resp.response.error).toBeUndefined();

        //vm.log(
        //    `Spent ${gas2USD(resp.response.usedGas)} USD$ in gas to reserve ${satIn} satoshis for ${minOut} tokens`,
        //);
    }

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        Blockchain.blockNumber = 1n;

        token = new OP_20({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });
        Blockchain.register(token);
        await token.init();
        await token.mintRaw(userAddress, 10_000_000n);

        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();
        Blockchain.msgSender = userAddress;

        // Set a base quote
        await createPool(1_000_000n, Blockchain.expandToDecimal(1, 8) * 1_000_000n);

        Blockchain.blockNumber += 1n;
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should not purge if there are no expired reservations', async () => {
        const buyer = Blockchain.generateRandomAddress();
        //await token.mintRaw(buyer, 100_000n);

        // Make a reservation in current block
        await makeReservation(buyer, 1_000_000n, 1n);

        // Make another reservation to trigger purge attempt
        await makeReservation(Blockchain.generateRandomAddress(), 50_000_000n, 1n);

        // No exceptions and no expired reservations means onNoPurge was executed successfully
        Assert.expect(true);
    });

    await vm.it('should purge a single expired reservation', async () => {
        const provider = await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 1_000_000n);

        // Make a reservation at current block
        await makeReservation(buyer, 100_000n, 1n);

        // Advance beyond expiration
        Blockchain.blockNumber = Blockchain.blockNumber + 10n;

        // Trigger purge with a new reservation
        await makeReservation(buyer, 100_000n, 1n);

        const reserve = await nativeSwap.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
    });

    await vm.it(
        'should purge a single expired reservation, (error, not enough liquidity)',
        async () => {
            const buyer = Blockchain.generateRandomAddress();

            // Make a reservation at current block
            await makeReservation(buyer, 100_000_000_000_000n, 1n);

            // Advance beyond expiration
            Blockchain.blockNumber = Blockchain.blockNumber + 10n;

            // Trigger purge with a new reservation
            //await makeReservation(buyer, 100_000n, 1n);

            const reserve = await nativeSwap.getReserve(tokenAddress);
            Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
        },
    );

    await vm.it(
        'should purge expired reservations and not be able to reserve if not expired',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(100_000));
            const buyer = Blockchain.generateRandomAddress();

            // Create reservations at blocks 1000,1001,1002
            Blockchain.blockNumber = 1000n;
            await makeReservation(buyer, 100_000n, 1n);

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1001n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 1');
            }).toThrow('Reservation already active');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1002n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 2');
            }).toThrow('Reservation already active');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1003n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 3');
            }).toThrow('Reservation already active');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1004n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 4');
            }).toThrow('Reservation already active');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1005n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 5');
            }).toThrow('Reservation already active');

            // Advance beyond expiration for first two reservations
            Blockchain.blockNumber = 1006n;
            // Purge first batch
            await makeReservation(buyer, 50_000n, 1n);

            // Advance further to expire third reservation
            Blockchain.blockNumber = 1012n;
            await makeReservation(buyer, 50_000n, 1n);

            const reserve = await nativeSwap.getReserve(tokenAddress);
            Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
        },
    );

    await vm.it('should handle reservations expiring exactly at the boundary block', async () => {
        const provider = await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 1_000_000n);

        // Reservation at block 3000
        Blockchain.blockNumber = 3000n;
        await makeReservation(buyer, 100_000n, 1n);

        // Exactly 5 blocks later at 3005
        Blockchain.blockNumber = 3006n;

        // Purge
        await makeReservation(buyer, 10_000n, 1n);

        const reserve = await nativeSwap.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
    });

    await vm.it(
        'should handle a large number of reservations spread across many blocks and purge them efficiently',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(21_000_000));
            Blockchain.blockNumber = 1000n;

            // Create 50 reservations over 10 different blocks
            for (let i = 0; i < 5; i++) {
                Blockchain.blockNumber = 1000n + BigInt(i);

                for (let x = 0; x < 10; x++) {
                    await makeReservation(Blockchain.generateRandomAddress(), 10_000n, 1n);
                }
            }

            // Advance beyond expiration
            Blockchain.blockNumber = 20000n;

            //const reserveBefore = await nativeSwap.getReserve(tokenAddress);
            //Assert.expect(reserveBefore.reserved).toEqual(0n);

            // Purge
            await makeReservation(Blockchain.generateRandomAddress(), 10_000n, 1n);

            const reserve = await nativeSwap.getReserve(tokenAddress);
            Assert.expect(reserve.reserved).toBeGreaterThan(0n);
        },
    );

    await vm.it(
        'should correctly purge reservations expiring exactly at boundary blocks multiple times',
        async () => {
            const provider = await addProviderLiquidity(Blockchain.expandTo18Decimals(2000));
            const buyer = Blockchain.generateRandomAddress();
            await token.mintRaw(buyer, 10_000_000n);

            // Reservation at block 2000
            Blockchain.blockNumber = 2000n;
            await makeReservation(buyer, 100_000n, 1n);

            Blockchain.blockNumber = 2006n; // expiration

            // Another cycle
            await makeReservation(buyer, 50_000n, 1n);

            Blockchain.blockNumber = 2012n; // another expiration
            await makeReservation(buyer, 50_000n, 1n);

            const reserve = await nativeSwap.getReserve(tokenAddress);
            Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
        },
    );

    await vm.it('should handle consecutive purges gracefully', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(5000));
        const buyer = Blockchain.generateRandomAddress();

        // Reservations at blocks 3000..3004
        for (let i = 0; i < 5; i++) {
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.blockNumber = 3000n + BigInt(i);
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;
            await makeReservation(buyer, 200_000n, 1n);
        }

        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;
        await makeReservation(buyer, 200_000n, 1n);

        // Advance and purge
        Blockchain.blockNumber = 3010n;
        await makeReservation(buyer, 10_000n, 1n);

        const reserve = await nativeSwap.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
    });

    await vm.it('should handle scenario where no providers remain after purge', async () => {
        const provider = await addProviderLiquidity(Blockchain.expandTo18Decimals(10));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        Blockchain.blockNumber = 4000n;
        await makeReservation(buyer, 100_000_000n, 1n);

        Blockchain.blockNumber = 4010n;
        await makeReservation(buyer, 10_000n, 1n);

        const reserve = await nativeSwap.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toBeGreaterThanOrEqual(0n);
    });

    await vm.it('should handle reservations with very large block numbers', async () => {
        const provider = await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        const nearMaxBlock = 2n ** 32n - 11n;
        Blockchain.blockNumber = nearMaxBlock;

        await makeReservation(buyer, 100_000n, 1n);

        Blockchain.blockNumber = nearMaxBlock + 10n;

        await makeReservation(buyer, 10_000n, 1n);

        const reserve = await nativeSwap.getReserve(tokenAddress);
        Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
    });

    await vm.it(
        'should correctly handle purges with both priority and normal providers present',
        async () => {
            const normalProvider1 = await addProviderLiquidity(
                Blockchain.expandTo18Decimals(10_000),
                false,
            );
            const normalProvider2 = await addProviderLiquidity(
                Blockchain.expandTo18Decimals(10_000),
                false,
            );
            const priorityProvider1 = await addProviderLiquidity(
                Blockchain.expandTo18Decimals(10_000),
                true,
            );
            const priorityProvider2 = await addProviderLiquidity(
                Blockchain.expandTo18Decimals(10_000),
                true,
            );

            const buyer = Blockchain.generateRandomAddress();
            for (let i = 0; i < 8; i++) {
                const buyer = Blockchain.generateRandomAddress();
                Blockchain.blockNumber = 6000n + BigInt(i);
                await makeReservation(buyer, 50_000n, 1n);
            }

            Blockchain.blockNumber = 6010n;
            await makeReservation(buyer, 50_000n, 1n);

            Blockchain.blockNumber = 6020n;
            await makeReservation(buyer, 50_000n, 1n);

            const reserve = await nativeSwap.getReserve(tokenAddress);
            Assert.expect(reserve.liquidity).toBeGreaterThan(0n);
        },
    );
});
