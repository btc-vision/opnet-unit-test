import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, gas2USD, OP20, opnet, OPNetUnit, } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { ReserveResult } from '../../contracts/NativeSwapTypes.js';

await opnet('NativeSwap: Purging Reservations', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP20;

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

        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: Blockchain.generateRandomAddress(),
        });

        await token.mintRaw(userAddress, initialLiquidity);
        await token.increaseAllowance(userAddress, nativeSwap.address, initialLiquidity);

        await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: initialLiquidityProvider,
            network: Blockchain.network,
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

        await token.increaseAllowance(provider, nativeSwap.address, amountIn);
        const resp = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            network: Blockchain.network,
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

        Blockchain.blockNumber = 100n;
        Blockchain.msgSender = userAddress;

        token = new OP20({
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
        const stackingContractAddress: Address = Blockchain.generateRandomAddress();
        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: stackingContractAddress,
        });

        // Set a base quote
        await createPool(100000000000000n, Blockchain.expandToDecimal(1, 18) * 1_000_000n);

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
        await makeReservation(buyer, 10000n, 1n);

        // Advance beyond expiration
        Blockchain.blockNumber = Blockchain.blockNumber + 20n;
        // Trigger purge
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it('should purge a single expired reservation, two provider', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));

        const buyer = Blockchain.generateRandomAddress();

        // Make a reservation at current block
        await makeReservation(buyer, 100_000_000_000n, 1n);

        // Advance beyond expiration
        Blockchain.blockNumber = Blockchain.blockNumber + 20n;
        // Trigger purge
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));

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
            Blockchain.blockNumber = Blockchain.blockNumber + 1n;
            await makeReservation(buyer, 100_000n, 1n);

            await Assert.expect(async () => {
                Blockchain.blockNumber = Blockchain.blockNumber + 1n;
                await makeReservation(buyer, 100_000n, 1n);
            }).toThrow();

            await Assert.expect(async () => {
                Blockchain.blockNumber = Blockchain.blockNumber + 1n;
                await makeReservation(buyer, 100_000n, 1n);
            }).toThrow();

            await Assert.expect(async () => {
                Blockchain.blockNumber = Blockchain.blockNumber + 1n;
                await makeReservation(buyer, 100_000n, 1n);
            }).toThrow();

            await Assert.expect(async () => {
                Blockchain.blockNumber = Blockchain.blockNumber + 1n;
                await makeReservation(buyer, 100_000n, 1n);
            }).toThrow();

            await Assert.expect(async () => {
                Blockchain.blockNumber = Blockchain.blockNumber + 1n;
                await makeReservation(buyer, 100_000n, 1n);
            }).toThrow();

            Blockchain.blockNumber = Blockchain.blockNumber + 1n;
            // Trigger a purge
            await addProviderLiquidity(Blockchain.expandTo18Decimals(100_000));

            // Advance beyond expiration for first two reservations
            Blockchain.blockNumber = Blockchain.blockNumber + 10n;

            // Purge first batch
            await makeReservation(buyer, 50_000n, 1n);

            // Advance further to expire third reservation
            Blockchain.blockNumber = Blockchain.blockNumber + 10n;
            // Trigger a purge
            await addProviderLiquidity(Blockchain.expandTo18Decimals(100_000));

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
        // Trigger purge
        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it(
        'should handle a large number of reservations spread across many blocks and purge them efficiently',
        async () => {
            await addProviderLiquidity(Blockchain.expandTo18Decimals(1_000_000));
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
            await addProviderLiquidity(Blockchain.expandTo18Decimals(1_000_000));
            Blockchain.blockNumber = 1000n;

            // Create 50 reservations over 10 different blocks
            for (let i = 0; i < 100; i++) {
                await makeReservation(Blockchain.generateRandomAddress(), 20000n, 1n);
            }

            // Advance beyond expiration
            Blockchain.blockNumber = 1026n;

            // Purge
            await addProviderLiquidity(Blockchain.expandTo18Decimals(1_000_000));

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            Assert.expect(reserve.reservedLiquidity).toEqual(0n);
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
            await addProviderLiquidity(Blockchain.expandTo18Decimals(2000));

            // Another cycle
            Blockchain.blockNumber = 2016n; // expiration
            await makeReservation(buyer, 50_000n, 1n);

            Blockchain.blockNumber = 2022n; // another expiration
            await addProviderLiquidity(Blockchain.expandTo18Decimals(2000));

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
        await addProviderLiquidity(Blockchain.expandTo18Decimals(5000));

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(0n);
    });

    await vm.it('should handle reservations with very large block numbers', async () => {
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));
        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        const nearMaxBlock = 2n ** 32n - 22n;
        Blockchain.blockNumber = nearMaxBlock;

        await makeReservation(buyer, 100_000n, 1n);

        Blockchain.blockNumber = Blockchain.blockNumber + 10n;
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));
        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve.reservedLiquidity).toEqual(0n);

        Blockchain.blockNumber = Blockchain.blockNumber + 10n;
        await makeReservation(buyer, 10_000n, 1n);

        const reserve2 = await nativeSwap.getReserve({
            token: tokenAddress,
        });
        Assert.expect(reserve2.reservedLiquidity).toEqual(1510209085354041326n);
    });

    await vm.it('should handle purge reservation spread in multiple block ranges', async () => {
        //await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));

        const buyer = Blockchain.generateRandomAddress();
        await token.mintRaw(buyer, 10_000_000n);

        Blockchain.blockNumber = 1000n;
        await makeReservation(buyer, 100_000n, 1n);

        Blockchain.blockNumber = 1006n;
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));

        Blockchain.blockNumber = 1016n;
        await makeReservation(buyer, 10_000n, 1n);

        Blockchain.blockNumber = 1022n;
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));

        Blockchain.blockNumber = 1032n;
        await makeReservation(buyer, 10_000n, 1n);

        Blockchain.blockNumber = 1038n;
        await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));

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

        await makeReservation(buyer, 20000n, 1n);
        await makeReservation(buyer2, 20000n, 1n);
        await makeReservation(buyer3, 20000n, 1n);
        await makeReservation(buyer4, 20000n, 1n);

        Blockchain.blockNumber = 7857n;

        for (let i = 0; i < 2000; i++) {
            const buyer5 = Blockchain.generateRandomAddress();

            await makeReservation(buyer5, 20000n, 1n);
        }

        Blockchain.blockNumber = Blockchain.blockNumber + 20n;

        await makeReservation(buyer, 20000n, 1n);
        await makeReservation(buyer2, 20000n, 1n);
        await makeReservation(buyer3, 20000n, 1n);
        await makeReservation(buyer4, 20000n, 1n);

        Blockchain.blockNumber = Blockchain.blockNumber + 10n;

        // Trigger purge
        for (let i = 0; i < 14; i++) {
            Blockchain.blockNumber = Blockchain.blockNumber + 1n;
            await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000));
        }

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

                await makeReservation(buyer, 50_000n, 1n);
            }

            Blockchain.blockNumber = Blockchain.blockNumber + 6n;
            await makeReservation(buyer, 50_000n, 1n);

            Blockchain.blockNumber = 6040n;
            await addProviderLiquidity(Blockchain.expandTo18Decimals(10_000), true);

            const reserve = await nativeSwap.getReserve({
                token: tokenAddress,
            });

            Assert.expect(reserve.reservedLiquidity).toEqual(0n);
        },
    );
});
