import { Address } from '@btc-vision/transaction';
import { Blockchain, OP_20, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient, ReserveResult } from '../../contracts/NativeSwapTypes.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { createRecipientsOutput, gas2USD } from '../utils/TransactionUtils.js';
import { BitcoinUtils } from 'opnet';

export class NativeSwapTestHelper {
    public dataNative: { x: number; y: number[] }[] = [];
    public open = 0;

    public toSwap: { a: Address; r: Recipient[] }[] = [];
    public toAddLiquidity: { a: Address; r: Recipient[] }[] = [];

    public tokenDecimals = 18;
    public point25InitialLiquidity = 52_500n * 10n ** BigInt(this.tokenDecimals); //10n ** BigInt(this.tokenDecimals); //

    public userAddress: Address = Blockchain.generateRandomAddress();
    public tokenAddress: Address = Blockchain.generateRandomAddress();
    public nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    public initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    public floorPrice: bigint = 10n ** 18n / 1500n; // approx 1/1500 //10_000_000_000n; //

    constructor(private vm: OPNetUnit) {}

    public _token: OP_20 | null = null;

    public get token(): OP_20 {
        if (!this._token) {
            throw new Error('Token not initialized');
        }

        return this._token;
    }

    public set token(token: OP_20) {
        this._token = token;
    }

    public _nativeSwap: NativeSwap | null = null;

    public get nativeSwap(): NativeSwap {
        if (!this._nativeSwap) {
            throw new Error('NativeSwap not initialized');
        }

        return this._nativeSwap;
    }

    public set nativeSwap(nativeSwap: NativeSwap) {
        this._nativeSwap = nativeSwap;
    }

    public get tokenAmountFor10kSat(): bigint {
        return this.floorPrice * 10_001n;
    }

    private _startBlock: bigint = 0n;

    public set startBlock(block: bigint) {
        this._startBlock = block;
    }

    public scaleToken(n: bigint): bigint {
        return BitcoinUtils.expandToDecimals(n.toString(), this.tokenDecimals);
    }

    /**
     * Hook this once at the beginning of your test suite.
     * It wires the vm.beforeEach logic (initializing the chain and your contracts).
     */
    public init(): void {
        this.vm.beforeEach(async () => {
            // Reset variables each time
            this.dataNative = [
                {
                    x: 1,
                    y: [0, 0, 0, 0],
                },
            ];
            this.open = 0;
            this.toSwap = [];
            this.toAddLiquidity = [];

            Blockchain.blockNumber = this._startBlock;

            // Reset blockchain state
            Blockchain.dispose();
            Blockchain.clearContracts();
            await Blockchain.init();

            // Instantiate and register the OP_20 token
            this.token = new OP_20({
                file: 'MyToken',
                deployer: this.userAddress,
                address: this.tokenAddress,
                decimals: this.tokenDecimals,
            });

            Blockchain.register(this.token);
            await this.token.init();

            // Mint tokens to the user
            const totalSupply = Blockchain.expandToDecimal(1_000_000_000_000, this.tokenDecimals);
            await this.token.mintRaw(this.userAddress, totalSupply);

            // Instantiate and register the nativeSwap contract
            this.nativeSwap = new NativeSwap(this.userAddress, this.nativeSwapAddress);
            Blockchain.register(this.nativeSwap);
            await this.nativeSwap.init();

            // Add liquidity
            Blockchain.txOrigin = this.userAddress;
            Blockchain.msgSender = this.userAddress;
            await this.createNativeSwapPool(this.floorPrice, this.point25InitialLiquidity);
        });
    }

    /**
     * Hook this once at the beginning of your test suite.
     * It wires the vm.afterEach logic (cleaning up after each test).
     */
    public afterEach(): void {
        this.vm.afterEach(() => {
            if (this.nativeSwap) {
                this.nativeSwap.dispose();
            }
            if (this.token) {
                this.token.dispose();
            }
            Blockchain.dispose();
        });
    }

    /**
     * Candle-style logger.
     * Matches your snippet with a candle structure = [open, open, close, close].
     */
    public recordCandle(blockNumber: bigint, closeFloat: number): void {
        if (this.open !== 0) {
            this.dataNative.push({
                x: Number(blockNumber.toString()),
                y: [this.open, this.open, closeFloat, closeFloat],
            });
        } else {
            this.dataNative.push({
                x: Number(blockNumber.toString()),
                y: [closeFloat, closeFloat, closeFloat, closeFloat],
            });
        }
        this.open = closeFloat; // update open to be the new close
    }

    /**
     * Helper: Create the NativeSwap pool with initial liquidity
     */
    public async createNativeSwapPool(floorPrice: bigint, initLiquidity: bigint): Promise<void> {
        // Approve NativeSwap to take tokens
        Blockchain.txOrigin = this.userAddress;
        Blockchain.msgSender = this.userAddress;
        await this.token.approve(this.userAddress, this.nativeSwap.address, initLiquidity);

        console.log(
            'Creating pool with floor price',
            floorPrice,
            'and initial liquidity',
            initLiquidity,
        );
        // 10000000000n 1000000000000000000n

        // Create the pool
        await this.nativeSwap.createPool({
            token: this.token.address,
            floorPrice,
            initialLiquidity: initLiquidity,
            receiver: this.initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 4000,
        });

        Blockchain.blockNumber += 1n;

        const quote = await this.nativeSwap.getQuote({
            token: this.token.address,
            satoshisIn: 100_000_000n,
        });

        let { requiredSatoshis: amountIn, price, scale } = quote;
        if (amountIn !== 100_000_000n) {
            price = (price * 100_000_000n) / amountIn;
        }

        const reversedPrice =
            1 / parseFloat(BitcoinUtils.formatUnits(price / scale, this.tokenDecimals));
        this.recordCandle(Blockchain.blockNumber, reversedPrice);
    }

    public async reportQuote(): Promise<void> {
        const quote = await this.nativeSwap.getQuote({
            token: this.token.address,
            satoshisIn: 100_000_000n,
        });
        let { requiredSatoshis: amountIn, price, scale } = quote;

        if (amountIn !== 100_000_000n) {
            price = (price * 100_000_000n) / amountIn;
        }

        const reversedPrice =
            1 / parseFloat(BitcoinUtils.formatUnits(price / scale, this.tokenDecimals));
        this.recordCandle(Blockchain.blockNumber, reversedPrice);
    }

    public async randomReserve(
        amount: bigint,
        minimumAmountOut: bigint,
        forLP = false,
        rnd = true,
    ): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;

        let provider: Address = Blockchain.txOrigin;
        if (rnd) {
            provider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        const r = await this.nativeSwap.reserve({
            token: this.tokenAddress,
            maximumAmountIn: amount,
            minimumAmountOut: minimumAmountOut,
            forLP,
        });

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            if (forLP) {
                this.toAddLiquidity.push({
                    a: provider,
                    r: decoded.recipients,
                });
            } else {
                this.toSwap.push({
                    a: provider,
                    r: decoded.recipients,
                });
            }
        } else {
            this.vm.fail('No recipients found in reservation (swap) event.');
        }

        this.vm.info(
            `Reserved ${BitcoinUtils.formatUnits(r.expectedAmountOut, this.tokenDecimals)} tokens for ${provider} with ${decoded.recipients.length} recipients, amount of sat requested: ${decoded.totalSatoshis}`,
        );

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
        return r;
    }

    public async listTokenRandom(
        l: bigint,
        provider: Address = Blockchain.generateRandomAddress(),
    ): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = this.userAddress;
        Blockchain.msgSender = this.userAddress;
        // Transfer tokens from userAddress to provider
        await this.token.transfer(this.userAddress, provider, l);

        // Approve EWMA contract to spend tokens
        await this.token.approve(provider, this.nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await this.nativeSwap.listLiquidity({
            token: this.tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: l,
            priority: false,
            disablePriorityQueueFees: false,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        this.vm.info(`Added liquidity for ${l} tokens`);
    }

    public async swapAll(clearList: boolean = true): Promise<void> {
        for (const reservation of this.toSwap) {
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await this.nativeSwap.swap({
                token: this.tokenAddress,
            });

            const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                s.response.events[s.response.events.length - 1].data,
            );

            this.vm.log(
                `Swapped spent ${gas2USD(s.response.usedGas)} USD in gas, ${d.amountOut} tokens`,
            );
        }
        Blockchain.txOrigin = this.userAddress;
        Blockchain.msgSender = this.userAddress;
        if (clearList) this.toSwap = [];
    }

    public async reserveAddLiquidity(
        l: bigint,
        rnd = false,
        provider: Address = Blockchain.txOrigin,
    ): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;
        if (rnd) {
            provider = Blockchain.generateRandomAddress();
            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        // Transfer tokens from userAddress to provider
        Blockchain.txOrigin = this.userAddress;
        Blockchain.msgSender = this.userAddress;
        await this.token.transfer(this.userAddress, provider, l);

        // Approve EWMA contract to spend tokens
        await this.token.approve(provider, this.nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        // Reuse randomReserve for the actual reservation
        const r = await this.randomReserve(l, 0n, true, false);
        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);

        this.vm.log(
            `Adding liquidity potentially worth ${decoded.totalSatoshis} sat and reserving ${decoded.recipients.length} recipients.`,
        );

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
        return r;
    }

    public async addLiquidityRandom(): Promise<void> {
        for (const reservation of this.toAddLiquidity) {
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);

            // Approve again in case large amounts are needed
            await this.token.approve(
                reservation.a,
                this.nativeSwap.address,
                BitcoinUtils.expandToDecimals(1_000_000_000_000, this.tokenDecimals),
            );

            const s = await this.nativeSwap.addLiquidity({
                token: this.tokenAddress,
                receiver: reservation.a.p2tr(Blockchain.network),
            });

            const d = NativeSwapTypesCoders.decodeLiquidityAddedEvent(
                s.response.events[s.response.events.length - 1].data,
            );
            this.vm.log(
                `Added liquidity! Spent ${gas2USD(s.response.usedGas)} USD in gas, totalSatoshisSpent: ${d.totalSatoshisSpent}, totalTokensContributed: ${d.totalTokensContributed}, virtualTokenExchanged: ${d.virtualTokenExchanged}`,
            );
        }

        Blockchain.txOrigin = this.userAddress;
        Blockchain.msgSender = this.userAddress;
        this.toAddLiquidity = [];
    }

    public async removeLiquidity(p: Address): Promise<void> {
        const rn = Blockchain.txOrigin;

        Blockchain.txOrigin = p;
        Blockchain.msgSender = p;

        const r = await this.nativeSwap.removeLiquidity({ token: this.tokenAddress });
        const d = NativeSwapTypesCoders.decodeLiquidityRemovedEvent(
            r.response.events[r.response.events.length - 1].data,
        );

        this.vm.log(
            `Removed liquidity! Spent ${gas2USD(r.response.usedGas)} USD in gas, btcOwed: ${d.btcOwed} sat, tokenAmount: ${d.tokenAmount} tokens`,
        );

        Blockchain.txOrigin = rn;
        Blockchain.msgSender = rn;
    }
}
