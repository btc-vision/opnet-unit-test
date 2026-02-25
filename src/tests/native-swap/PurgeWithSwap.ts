import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, gas2USD, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient, ReserveResult } from '../../contracts/NativeSwapTypes.js';
import { BitcoinUtils } from 'opnet';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { MotoContract } from '../../contracts/MotoContract.js';
import bitcoin from '@btc-vision/bitcoin';

Blockchain.changeNetwork(bitcoin.networks.opnetTestnet);

await opnet('NativeSwap: Purging Reservations', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: MotoContract;
    let toSwap: { a: Address; r: Recipient[] }[] = [];
    let usedReservationAddresses: Address[] = [];

    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeAddress: Address = Blockchain.generateRandomAddress();
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
        await token.increaseAllowance(userAddress, nativeSwap.address, initialLiquidity);

        await nativeSwap.setStakingContractAddress({
            stakingContractAddress: Blockchain.generateRandomAddress(),
        });

        await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: initialLiquidityProvider,
            network: Blockchain.network,
            antiBotEnabledFor: antiBotEnabledFor,
            antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 100,
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

    async function listTokenRandom(
        l: bigint,
        provider: Address = Blockchain.generateRandomAddress(),
        priority: boolean = false,
    ): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Transfer tokens from userAddress to provider
        await token.safeTransfer(userAddress, provider, l);

        // Approve NativeSwap contract to spend tokens
        await token.increaseAllowance(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const liquid = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider,
            network: Blockchain.network,
            amountIn: l,
            priority: priority,
            disablePriorityQueueFees: false,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        vm.info(`Added liquidity for ${l} tokens - ${gas2USD(liquid.response.usedGas)} USD`);
    }

    /*const shuffle = <T>(array: T[]) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    };*/

    async function swapAll(): Promise<void> {
        //toSwap = shuffle(toSwap);

        for (let i = 0; i < toSwap.length; i++) {
            const reservation = toSwap[i];
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await nativeSwap.swap({ token: tokenAddress });
            const event = s.response.events[s.response.events.length - 2];
            if (event.type !== 'SwapExecuted') {
                throw new Error(`No swap executed event found, got ${event.type}`);
            }

            const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(event.data);
            vm.log(
                `Swapped spent ${gas2USD(s.response.usedGas)} USD in gas (pages: ${s.response.memoryPagesUsed}), ${d.amountOut} tokens`,
            );
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    async function randomReserve(
        amount: bigint,
        forLP: boolean = false,
        rnd: boolean = true,
        reuse: boolean = false,
    ): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;

        let provider: Address = Blockchain.txOrigin;
        if (rnd) {
            if (reuse) {
                provider = usedReservationAddresses.shift() as Address;

                if (!provider) {
                    throw new Error(`No more addresses to reuse`);
                }
            } else {
                provider = Blockchain.generateRandomAddress();
            }

            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        const r = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: amount,
            minimumAmountOut: 0n,
            activationDelay: 1,
        });

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            if (forLP) {
                throw new Error('Cannot reserve for LP');
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
            `Reserved ${BitcoinUtils.formatUnits(r.expectedAmountOut, tokenDecimals)} tokens (${gas2USD(r.response.usedGas)} USD in gas) for ${provider} with ${decoded.recipients.length} recipients, amount of sat requested: ${decoded.totalSatoshis}`,
        );

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
        return r;
    }

    async function makeReservation(
        buyer: Address,
        satIn: bigint,
        minOut: bigint,
    ): Promise<ReserveResult> {
        usedReservationAddresses.push(buyer);

        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const resp = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
            activationDelay: 1,
        });

        vm.info(
            `Reserved ${BitcoinUtils.formatUnits(resp.expectedAmountOut, tokenDecimals)} tokens (${gas2USD(resp.response.usedGas)} USD in gas)`,
        );

        Assert.expect(resp.response.error).toBeUndefined();

        return resp;
    }

    vm.beforeEach(async () => {
        toSwap = [];

        Blockchain.dispose();
        Blockchain.clearContracts();

        await Blockchain.init();

        Blockchain.blockNumber = 1n;

        token = new MotoContract({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });
        Blockchain.register(token);
        await token.init();

        const totalSupply = Blockchain.expandToDecimal(1_000_000_000_000, tokenDecimals);
        await token.mintRaw(userAddress, totalSupply);

        nativeSwap = new NativeSwap(userAddress, nativeAddress, 590_000_000_000n);
        Blockchain.register(nativeSwap);

        await nativeSwap.init();
        Blockchain.msgSender = userAddress;

        const floorPrice: bigint = 10n ** 18n / 500n; //10n ** 18n;
        const point25InitialLiquidity = 2052_500n * 10n ** BigInt(tokenDecimals);

        // Set a base quote
        await createPool(floorPrice, point25InitialLiquidity);

        Blockchain.blockNumber += 1n;
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should handle reservations expiring exactly at the boundary block', async () => {
        const buyer = Blockchain.generateRandomAddress();

        Blockchain.blockNumber = 3000n;

        // Reservation at block 3000
        await makeReservation(buyer, 100_000n, 1n);

        await listTokenRandom(BitcoinUtils.expandToDecimals(10000, tokenDecimals), undefined, true);

        for (let i = 0; i < 600; i++) {
            await listTokenRandom(
                BitcoinUtils.expandToDecimals(1000, tokenDecimals),
                undefined,
                false,
            );
        }

        await listTokenRandom(BitcoinUtils.expandToDecimals(10000, tokenDecimals), undefined, true);

        await addProviderLiquidity(Blockchain.expandTo18Decimals(1000));
        await token.mintRaw(buyer, 1_000_000n);

        const reserve3 = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        const startLp = reserve3.liquidity;

        for (let i = 0; i < 5; i++) {
            await randomReserve(100_000n, false, true);
            const a = Blockchain.generateRandomAddress();
            await makeReservation(a, 100_000n, 1n);
        }

        Blockchain.blockNumber += 2n;

        await swapAll();

        for (let i = 0; i < 5; i++) {
            await randomReserve(100_000n, false, true);
        }

        toSwap = [];

        // Exactly 5 blocks later at 3005
        Blockchain.blockNumber = 3100n;

        const reserve = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        //Assert.expect(reserve.reservedLiquidity).toEqual(0n);
        Assert.expect(startLp).toBeGreaterThan(reserve.liquidity);

        // Check again
        for (let i = 0; i < 350; i++) {
            //await randomReserve(1_500_000n / 2n, false, true);
            await makeReservation(Blockchain.generateRandomAddress(), 100_000n, 1n);
            await listTokenRandom(
                BitcoinUtils.expandToDecimals(1000, tokenDecimals),
                undefined,
                false,
            );
            await makeReservation(Blockchain.generateRandomAddress(), 1_500_000n / 2n, 1n);
        }

        Blockchain.blockNumber += 2n;

        await swapAll();

        // Exactly 5 blocks later at 3011
        Blockchain.blockNumber += 7n;

        await randomReserve(120_000_000n, false, true);

        for (let i = 0; i < 23; i++) {
            await randomReserve(1_500_000n, false, true, true);
            await makeReservation(Blockchain.generateRandomAddress(), 100_000n, 1n);
        }

        await randomReserve(15_000_000n, false, true, true);

        Blockchain.blockNumber += 6n;

        toSwap = [];

        for (let i = 0; i < 12; i++) {
            await makeReservation(Blockchain.generateRandomAddress(), 100_000n, 1n);
            await randomReserve(8_500_000n, false, true, true);
        }

        Blockchain.blockNumber += 2n;

        await swapAll();

        Blockchain.blockNumber += 4n;

        await randomReserve(55_000_000n, false, true);

        Blockchain.blockNumber += 10n;
        toSwap = [];

        await randomReserve(200_000_000n, false, true);

        for (let i = 0; i < 12; i++) {
            await randomReserve(5_500_000n, false, true, true);
        }

        Blockchain.blockNumber += 2n;

        await swapAll();

        vm.debug(`--------------- CHECK PRICE DIFFERENCE ---------------`);

        for (let i = 0; i < 12; i++) {
            await randomReserve(1_000_000n, false, true, true);
        }

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- SWAP 1 ---------------`);

        await swapAll();

        vm.debug(`--------------- CHECK PRICE DIFFERENCE ---------------`);

        for (let i = 0; i < 12; i++) {
            await randomReserve(1_000_000n, false, true, true);
        }

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- SWAP 2 ---------------`);

        await swapAll();

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- RESERVE GET QUOTE ---------------`);

        await randomReserve(1_000_000n, false, true, true);

        Blockchain.blockNumber += 25n;

        const reserve54 = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        vm.debug(
            `--------------- SIMULATE MASSIVE LISTING (${reserve54.virtualTokenReserve} - worth ${BitcoinUtils.formatUnits(reserve54.virtualBTCReserve, 8)} BTC) ---------------`,
        );

        await listTokenRandom(reserve54.virtualTokenReserve, undefined, true);

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- RESERVE ---------------`);

        await randomReserve(1_000_000n, false, true, true);

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- SWAP ---------------`);

        await swapAll();

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- RESERVE 2 ---------------`);

        await randomReserve(1_000_000n, false, true, true);

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- SWAP ---------------`);

        await swapAll();

        Blockchain.blockNumber += 1n;

        vm.debug(`--------------- SIMULATING LOTS OF SMALL TRADES ---------------`);

        for (let i = 0; i < 500; i++) {
            const s = await randomReserve(51_000n, false, true, true);

            if (i % 20 === 0) {
                //for (let y = 0; y < 20; y++) {
                await listTokenRandom(reserve54.virtualTokenReserve, undefined, false);
                //}

                vm.debug(`--------------- NEXT BLOCK. ---------------`);
                Blockchain.blockNumber += 1n;
                await swapAll();
            }
        }

        Blockchain.blockNumber += 1n;

        await swapAll();

        vm.debug(`--------------- SMALL TRADES DONE. FINAL QUOTE ---------------`);

        await randomReserve(1_000_000n, false, true, true);

        Blockchain.blockNumber += 10n;

        const reserves = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        console.log('reserves', reserves);

        Assert.expect(reserves.reservedLiquidity).toEqual(0n);
        Assert.expect(startLp).toBeGreaterThan(reserves.liquidity);
    });
});
