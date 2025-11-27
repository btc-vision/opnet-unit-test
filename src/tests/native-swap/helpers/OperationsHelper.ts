import { Address, FastMap } from '@btc-vision/transaction';
import { Assert, Blockchain, OP20, Transaction } from '@btc-vision/unit-test-framework';
import {
    assertNativeSwapBalanceHelper,
    assertProviderBalanceHelper,
    assertStakingBalanceHelper,
    TokenHelper,
} from './TokenHelper.js';
import { ProviderHelper, ProviderSnapshotHelper } from './ProviderHelper.js';
import { ReserveLiquidityHelper } from './ReserveLiquidityHelper.js';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { computeSlashing, expandNumberTo18Decimals } from './UtilsHelper.js';
import {
    CreatePoolResult,
    IActivateProviderEvent,
    IProviderFulfilledEvent,
    IReservationPurgedEvent,
    ITransferEvent,
    ListLiquidityResult,
    ReserveResult,
    SwapResult,
} from '../../../contracts/NativeSwapTypes.js';
import {
    logAction,
    logCreatePoolResult,
    logListLiquidityEvent,
    logListLiquidityResult,
    logRecipient,
    logReserveResult,
    logSwapEvents,
    logSwapResult,
} from '../../utils/LoggerHelper.js';
import { CreatePoolEventsHelper } from './CreatePoolEventsHelper.js';
import { LiquidityReserveHelper } from './LiquidityReserveHelper.js';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { SwapEventsHelper } from './SwapEventsHelper.js';
import { ListLiquidityEventsHelper } from './ListLiquidityEventsHelper.js';
import { ReserveLiquidityEventsHelper } from './ReserveLiquidityEventsHelper.js';

export class OperationsHelper {
    private tokens: TokenHelper[] = [];
    private providers: ProviderHelper[] = [];
    private reservations: ReserveLiquidityHelper[] = [];
    private originBackup: Address = new Address();
    private senderBackup: Address = new Address();
    private readonly nativeSwap: NativeSwap;

    private constructor(
        public numberOfTokens: number = 10,
        public activateLog: boolean = false,
        public nativeSwapOwnerAddress: Address = Blockchain.generateRandomAddress(),
        public nativeSwapContractAddress: Address = Blockchain.generateRandomAddress(),
        public stakingContractAddress: Address = Blockchain.generateRandomAddress(),
    ) {
        this.nativeSwap = new NativeSwap(
            this.nativeSwapOwnerAddress,
            this.nativeSwapContractAddress,
        );
    }

    static async create(
        numberOfTokens: number = 10,
        activateLog: boolean = false,
    ): Promise<OperationsHelper> {
        const helper = new OperationsHelper(numberOfTokens, activateLog);
        await helper.initialize();

        return helper;
    }

    public dispose(): void {
        this.nativeSwap.dispose();
        this.disposeTokens();
        Blockchain.dispose();
    }

    public getToken(index: number): TokenHelper {
        if (index >= this.tokens.length) {
            throw new Error('Token index out of range');
        }

        return this.tokens[index];
    }

    public getProvider(providerId: bigint): ProviderHelper | null {
        const result = this.providers.find((p) => p.id === providerId);

        return result === undefined ? null : result;
    }

    public getProviderByAddress(providerAddress: Address): ProviderHelper | null {
        const result = this.providers.find(
            (p) => p.address.toString() === providerAddress.toString(),
        );

        return result === undefined ? null : result;
    }

    public removeProvider(provider: ProviderHelper): void {
        const index = this.providers.indexOf(provider);

        if (index === -1) {
            throw new Error('Provider not found');
        }

        this.providers.splice(index, 1);
    }

    public getReservation(reservationId: bigint): ReserveLiquidityHelper | null {
        const result = this.reservations.find((r) => r.reservationId === reservationId);

        return result === undefined ? null : result;
    }

    public async createPool(
        tokenHelper: TokenHelper,
        initialLiquidityAmount: bigint,
        floorPrice: bigint,
        maxReservesIn5Blocks: number = 100,
    ): Promise<ProviderHelper> {
        this.pushOriginSender();

        const provider: ProviderHelper = new ProviderHelper(
            tokenHelper.ownerAddress,
            tokenHelper,
            false,
            true,
        );

        const providerInitialTokenAmount: bigint = await provider.getBalance();

        const result = await this.internalCreatePool(
            tokenHelper.token,
            provider.address,
            provider.address,
            floorPrice,
            initialLiquidityAmount,
            maxReservesIn5Blocks,
            true,
        );

        const decodedEvents = CreatePoolEventsHelper.decodeCreatePoolEvents(result.response.events);

        CreatePoolEventsHelper.assertCreatePoolEvents(
            this.nativeSwapContractAddress,
            provider,
            initialLiquidityAmount,
            decodedEvents,
        );

        await provider.update(this.nativeSwap);

        tokenHelper.isPoolCreated = true;
        tokenHelper.setInitialLiquidityProviderAddress(provider.address);

        Assert.expect(provider.liquidity).toEqual(initialLiquidityAmount);
        Assert.expect(provider.reserved).toEqual(0n);

        await assertProviderBalanceHelper(provider, providerInitialTokenAmount);
        await assertNativeSwapBalanceHelper(tokenHelper, initialLiquidityAmount);
        await assertStakingBalanceHelper(tokenHelper, 0n);
        await LiquidityReserveHelper.assertCurrentLiquidityReserve(
            this.nativeSwap,
            tokenHelper,
            initialLiquidityAmount,
            0n,
            initialLiquidityAmount / floorPrice,
            initialLiquidityAmount,
        );

        this.popOriginSender();

        this.providers.push(provider);
        return provider;
    }

    public async listLiquidity(
        tokenHelper: TokenHelper,
        providerAddress: Address,
        amountIn: bigint,
        priority: boolean = false,
    ): Promise<ProviderHelper> {
        // Create the provider
        const provider: ProviderHelper = new ProviderHelper(providerAddress, tokenHelper, priority);

        // List provider liquidity
        await this.relistLiquidity(provider, amountIn, priority);

        // Add provider to providers array
        this.providers.push(provider);

        return provider;
    }

    public async relistLiquidity(
        provider: ProviderHelper,
        amountIn: bigint,
        priority: boolean,
    ): Promise<void> {
        this.pushOriginSender();

        // Get initial balances and reserve
        const initialReserve = await LiquidityReserveHelper.create(
            this.nativeSwap,
            provider.tokenHelper,
        );

        if (this.activateLog) {
            initialReserve.logToConsole();
        }

        const initialProviderLiquidity = provider.liquidity;
        const initialProviderBalance = await provider.getBalance();
        const initialStakingBalance = await provider.tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance = await provider.tokenHelper.getNativeSwapContractBalance();

        // List provider liquidity
        const result = await this.internalListLiquidity(
            provider.tokenHelper.token,
            provider.address,
            amountIn,
            priority,
            provider.address,
            false,
            true,
        );

        // Compute tax if required
        let tax = 0n;

        if (provider.isPriority) {
            tax = (amountIn * 30n) / 1000n;
        }

        // Decode the list liquidity events
        const decodedEvents = ListLiquidityEventsHelper.decodeListLiquidityEvents(
            result.response.events,
        );

        // Validate list liquidity events
        ListLiquidityEventsHelper.assertListLiquidityEvents(
            this.nativeSwapContractAddress,
            this.stakingContractAddress,
            provider,
            amountIn,
            tax,
            decodedEvents,
        );

        provider.setFulfilled(false);

        // Update the provider
        await provider.update(this.nativeSwap);

        // Validate provider liquidity
        const newProviderLiquidity = initialProviderLiquidity + amountIn - tax;
        Assert.expect(provider.liquidity).toEqual(newProviderLiquidity);

        // Validate provider balance
        // Should stay the same as we mint the exact amount in helper_listLiquidityNew
        const newProviderBalance = initialProviderBalance;
        await assertProviderBalanceHelper(provider, newProviderBalance);

        // Validate nativeswap balance
        const newNativeSwapBalance = initialNativeSwapBalance + amountIn - tax;
        await assertNativeSwapBalanceHelper(provider.tokenHelper, newNativeSwapBalance);

        // Validate staking balance
        const newStakingBalance = initialStakingBalance + tax;
        await assertStakingBalanceHelper(provider.tokenHelper, newStakingBalance);

        // Validate reserve
        const slashing = computeSlashing(initialReserve.virtualTokenReserve, amountIn);
        const newReserveLiquidity = initialReserve.liquidity + amountIn - tax;

        await LiquidityReserveHelper.assertCurrentLiquidityReserve(
            this.nativeSwap,
            provider.tokenHelper,
            newReserveLiquidity,
            initialReserve.reservedLiquidity,
            initialReserve.virtualBTCReserve,
            initialReserve.virtualTokenReserve + slashing + tax,
            this.activateLog,
        );

        this.popOriginSender();
    }

    public async reserveLiquidity(
        tokenHelper: TokenHelper,
        reserver: Address,
        amountInSats: bigint,
        minAmountOutTokens: bigint = 0n,
        activationDelay: number = 2,
        feesAddress: string = '',
    ): Promise<ReserveLiquidityHelper> {
        this.pushOriginSender();

        // Get initial balances and reserve
        const initialStakingBalance: bigint = await tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance = await tokenHelper.getNativeSwapContractBalance();
        const initialReserve = await LiquidityReserveHelper.create(this.nativeSwap, tokenHelper);

        // Create the reservation
        const result = await this.internalReserve(
            tokenHelper.token.address,
            reserver,
            amountInSats,
            minAmountOutTokens,
            activationDelay,
            feesAddress,
        );

        // Decode reservations events
        const decodedEvents = ReserveLiquidityEventsHelper.decodeReserveLiquidityEvents(
            result.response.events,
        );

        // Must have a valid reservation created event
        Assert.expect(decodedEvents.reservationCreatedEvent).toNotEqual(null);
        if (decodedEvents.reservationCreatedEvent === null) {
            throw new Error('No reservation created');
        }

        // When reservation complete and liquidity was reserved, we
        // must have at least 1 liquidity reserved event
        if (decodedEvents.reservationCreatedEvent.expectedAmountOut > 0n) {
            Assert.expect(decodedEvents.liquidityReservedEvents.length).toBeGreaterThan(0);
        }

        // Create a reservation object with the decoded events
        // and store it in the reservations array
        const reservation = await ReserveLiquidityHelper.create(
            this.nativeSwap,
            tokenHelper,
            reserver,
            decodedEvents.reservationCreatedEvent,
            decodedEvents.liquidityReservedEvents,
            this.providers,
        );

        this.reservations.push(reservation);

        // Process the reservation purged events and get the total purged amount
        const totalAmountPurged = this.processPurgedReservation(
            decodedEvents.purgedReservationEvents,
        );

        // Process the provider fulfilled events and get the total transferred to the staking contract
        const transferToStakingAmount = await this.processProviderFulfilled(
            decodedEvents.providerFulfilledEvents,
        );

        // Validate new staking balance
        const newStakingBalance = initialStakingBalance + transferToStakingAmount;
        await assertStakingBalanceHelper(tokenHelper, newStakingBalance);

        // Validate the new nativeSwap balance
        const newNativeSwapBalance = initialNativeSwapBalance - transferToStakingAmount;
        await assertNativeSwapBalanceHelper(tokenHelper, newNativeSwapBalance);

        // Validate the new reserve
        const newLiquidity = initialReserve.liquidity - transferToStakingAmount;
        const newReservedLiquidity =
            initialReserve.reservedLiquidity +
            (reservation !== null ? reservation.expectedAmountOut : 0n) -
            totalAmountPurged;

        await LiquidityReserveHelper.assertCurrentLiquidityReserve(
            this.nativeSwap,
            tokenHelper,
            newLiquidity,
            newReservedLiquidity,
            initialReserve.virtualBTCReserve,
            initialReserve.virtualTokenReserve,
        );

        this.popOriginSender();

        return reservation;
    }

    public async swap(
        reservation: ReserveLiquidityHelper,
        transaction: Transaction | null,
    ): Promise<void> {
        this.pushOriginSender();

        // Setup transaction.
        // If no transaction is provided, we create a transaction that will
        // contain the exact amount of satoshis for each provider in the reservation.
        // Otherwise, we use the provided transaction that may have different amounts.
        const localTransaction =
            transaction !== null ? transaction : reservation.createTransaction();

        Blockchain.transaction = localTransaction;

        // Get initial balances and reserve
        const initialReserve = await LiquidityReserveHelper.create(
            this.nativeSwap,
            reservation.tokenHelper,
        );
        const initialStakingBalance = await reservation.tokenHelper.getStakingContractBalance();
        const initialNativeSwapBalance =
            await reservation.tokenHelper.getNativeSwapContractBalance();
        const initialReserverBalance = await reservation.tokenHelper.getBalanceOf(
            reservation.reserver,
        );

        const initialSnapshot = await this.getReservedProvidersSnapshot(reservation);

        // Execute the swap
        const result = await this.internalSwap(
            reservation.tokenHelper.token.address,
            reservation.reserver,
        );

        // Decode swap events
        const swapEvents = SwapEventsHelper.decodeSwapEvents(result.response.events);

        // Ensure swap was executed
        Assert.expect(swapEvents.swapExecutedEvent).toNotEqual(null);
        if (swapEvents.swapExecutedEvent === null) {
            throw new Error('Swap not executed.');
        }

        const finalSnapshot = await this.getReservedProvidersSnapshot(reservation);

        const transactionTotalAmount = this.getTransactionTotalAmount(localTransaction);
        // The used amount must match the provided amount of satoshis
        Assert.expect(swapEvents.swapExecutedEvent.amountIn).toEqual(transactionTotalAmount);

        if (transactionTotalAmount === reservation.totalSatoshis && !reservation.isExpired()) {
            Assert.expect(reservation.expectedAmountOut).toEqual(
                swapEvents.swapExecutedEvent.amountOut + swapEvents.swapExecutedEvent.totalFees,
            );
        }

        // Ensure the swap goes to the reserver
        Assert.expect(
            swapEvents.swapExecutedEvent.buyer.toString() === reservation.reserver.toString(),
        );

        if (reservation.isExpired()) {
            Assert.expect(swapEvents.reservationFallbackEvent).toNotEqual(null);
        }

        // Ensure the amount transferred to the reserver match
        const transferAmountReservation = this.getTransferAmount(
            swapEvents.transferredEvents,
            this.nativeSwapContractAddress,
            reservation.reserver,
        );
        Assert.expect(transferAmountReservation).toEqual(swapEvents.swapExecutedEvent.amountOut);

        // Ensure the new reserver balance match
        const newReserverBalance = await reservation.tokenHelper.getBalanceOf(reservation.reserver);
        Assert.expect(newReserverBalance).toEqual(
            initialReserverBalance + transferAmountReservation,
        );

        // Get the amount transferred to the staking contract
        const transferAmountStaking = this.getTransferAmount(
            swapEvents.transferredEvents,
            this.nativeSwapContractAddress,
            this.stakingContractAddress,
        );

        // Process the ProviderActivated events
        await this.processProviderActivated(swapEvents.providerActivatedEvent);

        // Process the ProviderFulfilled events
        const fulfilledStakingAmount = await this.processProviderFulfilled(
            swapEvents.providerFulfilledEvents,
        );

        // Ensure the computed staking amount match the transferred amount
        const stakingAmount = fulfilledStakingAmount + swapEvents.swapExecutedEvent.totalFees;
        Assert.expect(transferAmountStaking).toEqual(stakingAmount);

        // Ensure the new balance of the staking contract is accurate
        const newStakingBalance = await reservation.tokenHelper.getStakingContractBalance();
        Assert.expect(newStakingBalance).toEqual(initialStakingBalance + stakingAmount);

        // Ensure the new balance of the nativeswap contract is accurate
        const newNativeSwapBalance = await reservation.tokenHelper.getNativeSwapContractBalance();
        Assert.expect(newNativeSwapBalance).toEqual(
            initialNativeSwapBalance - transferAmountStaking - transferAmountReservation,
        );

        // Ensure the liquidity reserve is accurate
        await LiquidityReserveHelper.assertCurrentLiquidityReserve(
            this.nativeSwap,
            reservation.tokenHelper,
            initialReserve.liquidity - transferAmountStaking - transferAmountReservation,
            initialReserve.reservedLiquidity - reservation.expectedAmountOut,
            initialReserve.virtualBTCReserve,
            initialReserve.virtualTokenReserve - stakingAmount,
        );

        // Validate reserved vs swapped providers and check their status
        SwapEventsHelper.assertReservedSwapperProviders(
            initialSnapshot,
            finalSnapshot,
            reservation,
            swapEvents,
        );

        Blockchain.transaction = null;

        this.popOriginSender();
    }

    private processPurgedReservation(purgedReservationEvents: IReservationPurgedEvent[]): bigint {
        let totalPurged: bigint = 0n;

        for (let i = 0; i < purgedReservationEvents.length; i++) {
            const purgedReservation = this.getReservation(purgedReservationEvents[i].reservationId);

            Assert.expect(purgedReservation).toNotEqual(null);

            if (purgedReservation !== null) {
                purgedReservation.purged = true;
                purgedReservation.purgeIndex = purgedReservationEvents[i].purgeIndex;
                purgedReservation.purgedAmount = purgedReservationEvents[i].purgedAmount;
                totalPurged += purgedReservation.purgedAmount;
            }
        }

        return totalPurged;
    }

    private async processProviderFulfilled(
        providerFulfilledEvents: IProviderFulfilledEvent[],
    ): Promise<bigint> {
        let transferToStakingAmount: bigint = 0n;

        for (let i = 0; i < providerFulfilledEvents.length; i++) {
            const provider = this.getProvider(providerFulfilledEvents[i].providerId);

            Assert.expect(provider).toNotEqual(null);

            if (provider === null) {
                throw new Error(`Provider not found`);
            }

            provider.setFulfilled(true);
            transferToStakingAmount += providerFulfilledEvents[i].stakedAmount;
            await provider.update(this.nativeSwap);
            Assert.expect(provider.liquidity).toEqual(0n);
            Assert.expect(provider.isActive).toEqual(false);

            //!!!! removeProvider(provider);
        }

        return transferToStakingAmount;
    }

    private async processProviderActivated(
        providerActivatedEvents: IActivateProviderEvent[],
    ): Promise<void> {
        for (let i = 0; i < providerActivatedEvents.length; i++) {
            const provider = this.getProvider(providerActivatedEvents[i].providerId);
            Assert.expect(provider).toNotEqual(null);

            if (provider === null) {
                throw new Error(`Provider not found`);
            }

            await provider.update(this.nativeSwap);
        }
    }

    private getTransferAmount(
        transferEvents: ITransferEvent[],
        from: Address,
        to: Address,
    ): bigint {
        const transfer = transferEvents.find(
            (t) => t.from.toString() === from.toString() && t.to.toString() == to.toString(),
        );

        return transfer === undefined ? 0n : transfer.amount;
    }

    private async getReservedProvidersSnapshot(
        reservation: ReserveLiquidityHelper,
    ): Promise<FastMap<bigint, ProviderSnapshotHelper>> {
        const result = new FastMap<bigint, ProviderSnapshotHelper>();

        for (let i = 0; i < reservation.recipients.length; i++) {
            const provider = this.getProvider(reservation.recipients[i].providerId);
            if (provider === null) {
                throw new Error(`Provider not found: ${reservation.recipients[i].providerId}`);
            }

            await provider.update(this.nativeSwap);

            result.set(provider.id, ProviderSnapshotHelper.create(provider));
        }

        return result;
    }

    private getTransactionTotalAmount(transaction: Transaction): bigint {
        let total: bigint = 0n;

        for (let i = 0; i < transaction.outputs.length; i++) {
            total += transaction.outputs[i].value;
        }

        return total;
    }

    private async createTokens(): Promise<void> {
        for (let i = 0; i < this.numberOfTokens; i++) {
            const ownerAddress: Address = Blockchain.generateRandomAddress();
            const token = await this.internalCreateToken(
                ownerAddress,
                18,
                expandNumberTo18Decimals(10000000),
            );

            this.tokens.push(
                new TokenHelper(
                    token,
                    ownerAddress,
                    this.stakingContractAddress,
                    this.nativeSwapContractAddress,
                    `TOKEN_${i}`,
                ),
            );
        }
    }

    private async initialize(): Promise<void> {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
        Blockchain.register(this.nativeSwap);
        await this.nativeSwap.init();

        await this.createTokens();

        this.pushOriginSender();
        Blockchain.txOrigin = this.nativeSwapOwnerAddress;
        Blockchain.msgSender = this.nativeSwapOwnerAddress;
        await this.nativeSwap.setStakingContractAddress({
            stakingContractAddress: this.stakingContractAddress,
        });
        this.popOriginSender();
    }

    private async internalCreateToken(
        deployer: Address,
        tokenDecimals: number,
        initialMintCount: bigint,
    ): Promise<OP20> {
        let token = new OP20({
            file: 'MyToken',
            deployer: deployer,
            address: Blockchain.generateRandomAddress(),
            decimals: tokenDecimals,
        });

        Blockchain.register(token);
        await token.init();
        await token.mintRaw(deployer, initialMintCount);

        return token;
    }

    private async internalCreatePool(
        token: OP20,
        owner: Address,
        receiver: Address,
        floorPrice: bigint,
        poolInitialLiquidity: bigint,
        maxReservesIn5BlocksPercent: number = 60,
        mint: boolean = false,
        antiBotEnabledFor: number = 0,
        antiBotMaximumTokensPerReservation: bigint = 0n,
    ): Promise<CreatePoolResult> {
        if (this.activateLog) {
            logAction('createPool');
        }
        Blockchain.txOrigin = owner;
        Blockchain.msgSender = owner;

        if (mint) {
            await token.mintRaw(owner, poolInitialLiquidity);
        }

        await token.increaseAllowance(owner, this.nativeSwap.address, poolInitialLiquidity);

        const result = await this.nativeSwap.createPool({
            token: token.address,
            floorPrice: floorPrice,
            initialLiquidity: poolInitialLiquidity,
            receiver: receiver,
            antiBotEnabledFor: antiBotEnabledFor,
            antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: maxReservesIn5BlocksPercent,
            network: Blockchain.network,
        });

        if (this.activateLog) {
            logCreatePoolResult(result);
            logListLiquidityEvent(result.response.events);
        }

        return result;
    }

    private async internalListLiquidity(
        token: OP20,
        caller: Address,
        amountIn: bigint,
        priority: boolean,
        providerAddress: Address,
        disablePriorityQueueFees: boolean,
        mint: boolean = true,
    ): Promise<ListLiquidityResult> {
        if (this.activateLog) {
            logAction('listLiquidity');
        }

        Blockchain.txOrigin = caller;
        Blockchain.msgSender = caller;

        if (mint) {
            await token.mintRaw(caller, amountIn);
            await token.increaseAllowance(caller, this.nativeSwap.address, amountIn);
        }

        const result = await this.nativeSwap.listLiquidity({
            token: token.address,
            receiver: providerAddress,
            amountIn: amountIn,
            priority: priority,
            disablePriorityQueueFees: disablePriorityQueueFees,
            network: Blockchain.network,
        });

        if (this.activateLog) {
            logListLiquidityResult(result);
            logListLiquidityEvent(result.response.events);
        }

        return result;
    }

    private async internalReserve(
        tokenAddress: Address,
        caller: Address,
        maximumAmountIn: bigint,
        minimumAmountOut: bigint = 0n,
        activationDelay: number = 2,
        feesAddress: string = '',
    ): Promise<ReserveResult> {
        if (this.activateLog) {
            logAction(`reserve`);
        }

        Blockchain.txOrigin = caller;
        Blockchain.msgSender = caller;

        const result = await this.nativeSwap.reserve(
            {
                token: tokenAddress,
                maximumAmountIn: maximumAmountIn,
                minimumAmountOut: minimumAmountOut,
                activationDelay: activationDelay,
            },
            feesAddress,
        );

        if (this.activateLog) {
            logReserveResult(result);
        }

        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            result.response.events,
        );

        if (this.activateLog) {
            for (let i = 0; i < decodedReservation.recipients.length; i++) {
                logRecipient(decodedReservation.recipients[i]);
            }
        }

        return result;
    }

    private async internalSwap(tokenAddress: Address, caller: Address): Promise<SwapResult> {
        if (this.activateLog) {
            logAction('swap');
        }

        Blockchain.txOrigin = caller;
        Blockchain.msgSender = caller;

        const result = await this.nativeSwap.swap({
            token: tokenAddress,
        });

        if (this.activateLog) {
            logSwapResult(result);
        }

        if (this.activateLog) {
            logSwapEvents(result.response.events);
        }

        return result;
    }

    private disposeTokens(): void {
        for (let i = 0; i < this.numberOfTokens; i++) {
            this.tokens[i].token.dispose();
        }

        this.tokens = [];
    }

    private pushOriginSender(): void {
        this.originBackup = Blockchain.txOrigin;
        this.senderBackup = Blockchain.msgSender;
    }

    private popOriginSender(): void {
        Blockchain.txOrigin = this.originBackup;
        Blockchain.msgSender = this.senderBackup;
    }
}
