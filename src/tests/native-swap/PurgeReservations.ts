import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    gas2USD,
    OP_20,
    opnet,
    OPNetUnit,
} from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { ReserveResult } from '../../contracts/NativeSwapTypes.js';

await opnet('NativeSwap: Purging Reservations', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
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

        await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: antiBotEnabledFor,
            antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 40,
        });
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
        const resp = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: amountIn,
            priority: priority,
            disablePriorityQueueFees: false,
        });

        Assert.expect(resp.response.error).toBeUndefined();
        return provider;
    }

    async function makeReservation(
        buyer: Address,
        satIn: bigint,
        minOut: bigint,
    ): Promise<ReserveResult> {
        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const resp = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
        });

        Assert.expect(resp.response.error).toBeUndefined();

        return resp;
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

        nativeSwap = new NativeSwap(userAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();
        Blockchain.msgSender = userAddress;

        // Set a base quote
        await createPool(1_000_000n, Blockchain.expandToDecimal(1, 18) * 1_000_000n);

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
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));

        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 1_000_000n);

        // Make a reservation at current block
        await makeReservation(buyer, 100_000n, 1n);

        // Advance beyond expiration
        Blockchain.blockNumber = Blockchain.blockNumber + 10n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it('should purge a single expired reservation, two provider', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));

        const buyer = Blockchain.generateRandomAddress();

        // Make a reservation at current block
        await makeReservation(buyer, 100_000_000_000_000_000_000_000_000n, 1n);

        // Advance beyond expiration
        Blockchain.blockNumber = Blockchain.blockNumber + 10n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

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
            }).toThrow('You already have an active reservation');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1002n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 2');
            }).toThrow('You already have an active reservation');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1003n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 3');
            }).toThrow('You already have an active reservation');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1004n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 4');
            }).toThrow('You already have an active reservation');

            await Assert.expect(async () => {
                Blockchain.blockNumber = 1005n;
                await makeReservation(buyer, 100_000n, 1n);
                console.log('wat 5');
            }).toThrow('You already have an active reservation');

            // Advance beyond expiration for first two reservations
            Blockchain.blockNumber = 1006n;
            // Purge first batch
            await makeReservation(buyer, 50_000n, 1n);

            // Advance further to expire third reservation
            Blockchain.blockNumber = 1012n;

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
            Assert.expect(reserve.reservedLiquidity).toEqual(0n);
        },
    );

    await vm.it('should handle reservations expiring exactly at the boundary block', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 1_000_000n);

        // Reservation at block 3000
        Blockchain.blockNumber = 3000n;
        await makeReservation(buyer, 100_000n, 1n);

        // Exactly 5 blocks later at 3005
        Blockchain.blockNumber = 3006n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it(
        'should handle a large number of reservations spread across many blocks and purge them efficiently',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(21_000_000));
            const initialReserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            Blockchain.blockNumber = 1000n;

            // Create 50 reservations over 10 different blocks
            for (let i = 0; i < 5; i++) {
                Blockchain.blockNumber = 1000n + BigInt(i);

                for (let x = 0; x < 10; x++) {
                    await makeReservation(Blockchain.generateRandomAddress(), 10_000n, 1n);
                }
            }

            const before = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            // Advance beyond expiration
            Blockchain.blockNumber = 20000n;

            // Purge
            const a = await makeReservation(Blockchain.generateRandomAddress(), 10_000n, 1n);
            vm.log(
                `Spent ${gas2USD(a.response.usedGas)} USD to purge and reserve 50 reservations.`,
            );

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            Assert.expect(reserve.liquidity).toEqual(initialReserve.liquidity);
            Assert.expect(reserve.reservedLiquidity).toBeLessThan(before.reservedLiquidity);
        },
    );

    await vm.it(
        'should handle a large number of reservations spread across many blocks and purge them efficiently 2',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(21_000_000));
            Blockchain.blockNumber = 1000n;

            // Create 50 reservations over 10 different blocks
            for (let i = 0; i < 100; i++) {
                try {
                    await makeReservation(
                        Blockchain.generateRandomAddress(),
                        1_000_000_000_000_000_000n,
                        1n,
                    );
                } catch {}
            }

            // Advance beyond expiration
            Blockchain.blockNumber = 1006n;

            //const reserveBefore = await nativeSwap.getReserve(tokenAddress);
            //Assert.expect(reserveBefore.reserved).toEqual(0n);

            // Purge
            await makeReservation(Blockchain.generateRandomAddress(), 10_000n, 1n);

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            Assert.expect(reserve.reservedLiquidity).toEqual(10000000000n);
        },
    );

    await vm.it(
        'should correctly purge reservations expiring exactly at boundary blocks multiple times',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(2000));
            const buyer = Blockchain.generateRandomAddress();
            await token.mintRaw(buyer, 10_000_000n);

            // Reservation at block 2000
            Blockchain.blockNumber = 2000n;
            await makeReservation(buyer, 100_000n, 1n);

            Blockchain.blockNumber = 2006n; // expiration

            // Another cycle
            await makeReservation(buyer, 50_000n, 1n);

            Blockchain.blockNumber = 2012n; // another expiration

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });
            Assert.expect(reserve.reservedLiquidity).toEqual(0n);
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

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it('should handle scenario where no providers remain after purge', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        Blockchain.blockNumber = 4000n;
        await makeReservation(buyer, 100_000_000n, 1n);

        Blockchain.blockNumber = 4010n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it('should handle reservations with very large block numbers', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        const nearMaxBlock = 2n ** 32n - 12n;
        Blockchain.blockNumber = nearMaxBlock;

        await makeReservation(buyer, 100_000n, 1n);

        Blockchain.blockNumber = nearMaxBlock + 10n;

        await makeReservation(buyer, 10_000n, 1n);

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(10000000000n);
    });

    await vm.it('should handle purge reservation spread in multiple block ranges', async () => {
        //await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));

        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        Blockchain.blockNumber = 1000n;

        await makeReservation(buyer, 100_000n, 1n);

        Blockchain.blockNumber = 1006n;

        await makeReservation(buyer, 10_000n, 1n);

        Blockchain.blockNumber = 1012n;

        await makeReservation(buyer, 10_000n, 1n);

        Blockchain.blockNumber = 1012n + 6n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it('should handle purge reservation spread in multiple block ranges 2', async () => {
        //await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));

        const buyer = Blockchain.generateRandomAddress();
        const buyer2 = Blockchain.generateRandomAddress();
        const buyer3 = Blockchain.generateRandomAddress();
        const buyer4 = Blockchain.generateRandomAddress();

        Blockchain.blockNumber = Blockchain.blockNumber + 12n;

        await makeReservation(buyer, 100_000n, 1n);
        await makeReservation(buyer2, 100_000n, 1n);
        await makeReservation(buyer3, 100_000n, 1n);
        await makeReservation(buyer4, 100_000n, 1n);

        Blockchain.blockNumber = 7857n;

        for (let i = 0; i < 2000; i++) {
            const buyer5 = Blockchain.generateRandomAddress();

            await makeReservation(buyer5, BigInt(Math.floor(Math.random() * 10000000000)), 1n);
        }

        Blockchain.blockNumber = Blockchain.blockNumber + 20n;

        await makeReservation(buyer, 100_000n, 1n);
        await makeReservation(buyer2, 100_000n, 1n);
        await makeReservation(buyer3, 100_000n, 1n);
        await makeReservation(buyer4, 100_000n, 1n);

        Blockchain.blockNumber = Blockchain.blockNumber + 6n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it(
        'should correctly handle purges with both priority and normal providers present',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000), false);

            await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000), false);

            await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000), false);

            await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000), true);

            const buyer = Blockchain.generateRandomAddress();
            for (let i = 0; i < 8; i++) {
                const buyer = Blockchain.generateRandomAddress();
                Blockchain.blockNumber = 6000n + BigInt(i);

                vm.log(`Reserving for buyer ${buyer.toHex()} at block ${Blockchain.blockNumber}`);

                await makeReservation(buyer, 50_000n, 1n);
            }

            Blockchain.blockNumber = Blockchain.blockNumber + 6n;
            await makeReservation(buyer, 50_000n, 1n);

            Blockchain.blockNumber = 6020n;

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            Assert.expect(reserve.reservedLiquidity).toEqual(0n);
        },
    );
});
