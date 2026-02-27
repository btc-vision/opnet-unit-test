import { Address } from '@btc-vision/transaction';
import { Blockchain, gas2USD, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
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

        const r = await nativeSwap.reserve(
            {
                token: tokenAddress,
                maximumAmountIn: amount,
                minimumAmountOut: 0n,
                activationDelay: 1,
            },
            '',
            true,
        );

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

    await vm.it('should crash', async () => {
        const buyer = Blockchain.generateRandomAddress();

        Blockchain.blockNumber = 3000n;

        await token.mintRaw(buyer, 1_000_000n);

        for (let i = 0; i < 5; i++) {
            await randomReserve(100_000n, false, true);
        }

        Blockchain.blockNumber += 2n;

        await swapAll();
    });
});
