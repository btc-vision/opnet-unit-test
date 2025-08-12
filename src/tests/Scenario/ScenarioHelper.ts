import { Assert, Blockchain, OP20 } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    logAction,
    logAddLiquidityEvents,
    logAddLiquidityResult,
    logApprovedExecutedEvent,
    logApproveResponse,
    logCallResponse,
    logCancelListingEvents,
    logCancelListingResult,
    logCreatePoolResult,
    logGetQuoteResult,
    logGetReserveResult,
    logLiquidityListedEvent,
    logListLiquidityResult,
    logParameter,
    logRemoveLiquidityEvents,
    logRemoveLiquidityResult,
    logReserveEvent,
    logReserveResult,
    logSwapEvents,
    logSwapResult,
    logTransferEvent,
} from '../utils/LoggerHelper.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { ReserveData } from '../utils/OperationHelper.js';
import { Address, NetEvent } from '@btc-vision/transaction';
import {
    GetProviderDetailsResult,
    GetQuoteResult,
    GetReserveResult,
    Recipient,
} from '../../contracts/NativeSwapTypes.js';
import { JSonExpectedEvent, parseExpectedEvent } from './JSonEvents.js';
import { ExpectedApprovedEvent } from './Expected/ExpectedApprovedEvent.js';
import { ExpectedTransferEvent } from './Expected/ExpectedTransferEvent.js';
import { ExpectedLiquidityListedEvent } from './Expected/ExpectedLiquidityListedEvent.js';
import { ExpectedLiquidityReservedEvent } from './Expected/ExpectedLiquidityReservedEvent.js';
import { ExpectedReservationCreatedEvent } from './Expected/ExpectedReservationCreatedEvent.js';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { ExpectedSwapExecutedEvent } from './Expected/ExpectedSwapExecutedEvent.js';
import { ExpectedLiquidityAddedEvent } from './Expected/ExpectedLiquidityAddedEvent.js';
import { ExpectedLiquidityRemovedEvent } from './Expected/ExpectedLiquidityRemovedEvent.js';
import { ExpectedActivateProviderEvent } from './Expected/ExpectedActivateProviderEvent.js';
import { BitcoinUtils } from 'opnet';

export interface OperationDefinition {
    command: string;
    parameters: Record<string, string>;
    recipients: Recipient[];
    expected: {
        throw: boolean;
        canthrow: boolean;
        events: JSonExpectedEvent[];
        stateCheck: Record<string, string>;
    };
    context: string;
}

export interface TestDefinition {
    name: string;
    operations: OperationDefinition[];
}

export interface ScenarioDefinition {
    tests: TestDefinition[];
    verbose: boolean;
}

export class ScenarioHelper {
    public _providerMap = new Map<string, string[]>();
    public dataNative: { x: number; y: number[] }[] = [];

    public open: number = 0;

    private _tokens: Map<string, OP20> = new Map<string, OP20>();

    private _reserveRecipients: Map<string, Map<string, Recipient[]>> = new Map<
        string,
        Map<string, Recipient[]>
    >();
    private _reserveExpirations: Map<string, Map<string, bigint>> = new Map<
        string,
        Map<string, bigint>
    >();

    private _notPurgedReservations: Map<string, boolean> = new Map<string, boolean>();

    private _fulfilledProvider: bigint[] = [];
    private _consumedProvider: string[] = [];
    private lastBlock: bigint = 0n;

    constructor(private verbose: boolean = false) {
        this.dataNative = [
            {
                x: 1,
                y: [0, 0, 0, 0],
            },
        ];
    }

    private _nativeSwap: NativeSwap | null = null;

    private get nativeSwap(): NativeSwap {
        if (!this._nativeSwap) {
            throw new Error('NativeSwap not initialized');
        }
        return this._nativeSwap;
    }

    private set nativeSwap(nativeSwap: NativeSwap) {
        this._nativeSwap = nativeSwap;
    }

    /**
     * Record a candle-style entry (OHLC in the form [open, open, close, close]).
     * Updates `dataNative` with the new candle and sets `open` to the last close.
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
        this.open = closeFloat; // update open to the new close
    }

    /**
     * Invoke getQuote for 100,000,000 sats, compute reversed price, and push it as a candle.
     */
    public async recordQuoteCandle(tokenName: string): Promise<void> {
        if (this.lastBlock === Blockchain.blockNumber) {
            return;
        }

        this.lastBlock = Blockchain.blockNumber;

        const token = this.getToken(tokenName);
        const decimals = token.decimals;

        const quote = await this.nativeSwap.getQuote({
            token: token.address,
            satoshisIn: 100_000_000n,
        });

        let { requiredSatoshis: amountIn, price, scale } = quote;
        // Adjust if requiredSatoshis != 100,000,000
        if (amountIn !== 100_000_000n) {
            price = (price * 100_000_000n) / amountIn;
        }

        // In your TestHelper, you do:
        // reversedPrice = 1 / parseFloat(BitcoinUtils.formatUnits(price / scale, tokenDecimals))
        const reversedPrice = 1 / parseFloat(BitcoinUtils.formatUnits(price / scale, decimals));

        this.recordCandle(Blockchain.blockNumber, reversedPrice);
    }

    public setBlockchainInfo(op: OperationDefinition): void {
        const blockNumber = BigInt(op.parameters['blockNumber']);
        const txOrigin = Address.fromString(op.parameters['txOrigin']);
        const msgSender = Address.fromString(op.parameters['msgSender']);

        if (this.verbose) {
            //logAction(`setBlockchainInfo`);
            //logParameter(`blockNumber`, blockNumber.toString());
            //logParameter(`txOrigin`, txOrigin.toString());
            //logParameter(`msgSender`, msgSender.toString());
        }

        Blockchain.txOrigin = txOrigin;
        Blockchain.msgSender = msgSender;
        Blockchain.blockNumber = blockNumber;

        for (const key in op.expected.stateCheck) {
            switch (key) {
                case 'blockNumber':
                    Assert.expect(op.expected.stateCheck['blockNumber']).toEqual(
                        Blockchain.blockNumber.toString(),
                    );
                    break;
                case 'msgSender':
                    Assert.expect(op.expected.stateCheck['msgSender']).toEqual(
                        Blockchain.msgSender.toString(),
                    );
                    break;
                case 'txOrigin':
                    Assert.expect(op.expected.stateCheck['txOrigin']).toEqual(
                        Blockchain.txOrigin.toString(),
                    );
                    break;
                default:
                    throw new Error('Not matching key');
            }
        }
    }

    public async initialize(_op: OperationDefinition): Promise<void> {
        if (this.verbose) {
            logAction(`initialize`);
        }

        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();
    }

    public async createNativeSwapContract(op: OperationDefinition): Promise<void> {
        const deployerAddress = Address.fromString(op.parameters['deployerAddress']);
        const contractAddress = Address.fromString(op.parameters['contractAddress']);

        if (this.verbose) {
            logAction(`createNativeSwapContract`);
            logParameter(`deployerAddress`, deployerAddress.toString());
            logParameter(`contractAddress`, contractAddress.toString());
        }

        this.nativeSwap = new NativeSwap(deployerAddress, contractAddress);
        Blockchain.register(this.nativeSwap);
        await this.nativeSwap.init();
    }

    public async createToken(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const tokenFileName = op.parameters['tokenFileName'];
        const deployerAddress = Address.fromString(op.parameters['deployerAddress']);
        const tokenAddress = Address.fromString(op.parameters['tokenAddress']);
        const tokenDecimals = parseInt(op.parameters['tokenDecimals']);
        const tokenTotalSupply = parseInt(op.parameters['tokenTotalSupply']);

        if (this.verbose) {
            logAction(`createToken`);
            logParameter(`tokenName`, tokenName);
            logParameter(`tokenFileName`, tokenFileName);
            logParameter(`deployerAddress`, deployerAddress.toString());
            logParameter(`tokenAddress`, tokenAddress.toString());
            logParameter(`tokenDecimals`, tokenDecimals.toString());
            logParameter(`tokenTotalSupply`, tokenTotalSupply.toString());
        }

        Assert.expect(this._tokens.has(tokenName)).toEqual(false);

        const token = new OP20({
            file: tokenFileName,
            deployer: deployerAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });

        this._tokens.set(tokenName, token);

        Blockchain.register(token);
        await token.init();

        await token.mintRaw(
            deployerAddress,
            Blockchain.expandToDecimal(tokenTotalSupply, tokenDecimals),
        );
    }

    public reset(_op: OperationDefinition): void {
        this.dataNative = [
            {
                x: 1,
                y: [0, 0, 0, 0],
            },
        ];

        this.lastBlock = 0n;
        this.open = 0;

        if (this.verbose) {
            logAction(`reset`);
        }

        if (this.nativeSwap) {
            this.nativeSwap.dispose();
        }

        this._tokens.forEach((token: OP20) => {
            token.dispose();
        });

        this._tokens.clear();

        Blockchain.dispose();
    }

    public async tokenApprove(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const owner = Address.fromString(op.parameters['owner']);
        const spender = Address.fromString(op.parameters['spender']);
        const amount = BigInt(op.parameters['amount']);

        if (this.verbose) {
            logAction(`approve`);
            logParameter(`tokenName`, tokenName);
            logParameter(`owner`, owner.toString());
            logParameter(`spender`, spender.toString());
            logParameter(`amount`, amount.toString());
        }

        const token = this.getToken(tokenName);
        const result = await token.increaseAllowance(owner, spender, amount);

        Assert.expect(result.events.length).toEqual(1);

        const event = NativeSwapTypesCoders.decodeApprovedEvent(
            result.events[result.events.length - 1].data,
        );

        if (this.verbose) {
            logApproveResponse(result);
            logApprovedExecutedEvent(event);
        }

        if (op.expected.events.length === 1) {
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
            const expectedEvent = parseExpectedEvent(
                op.expected.events[0],
            ) as ExpectedApprovedEvent;
            expectedEvent.validate(event);
            if (this.verbose) {
                Blockchain.log(`Validating events completed`);
            }
        }
    }

    public async tokenTransfer(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const from = Address.fromString(op.parameters['from']);
        const to = Address.fromString(op.parameters['to']);
        const amount = BigInt(op.parameters['amount']);

        if (this.verbose) {
            logAction(`transfer`);
            logParameter(`tokenName`, tokenName);
            logParameter(`from`, from.toString());
            logParameter(`to`, to.toString());
            logParameter(`amount`, amount.toString());
        }

        const token = this.getToken(tokenName);
        const result = await token.safeTransfer(from, to, amount);

        Assert.expect(result.events.length).toEqual(1);

        const event = NativeSwapTypesCoders.decodeTransferEvent(
            result.events[result.events.length - 1].data,
        );

        if (this.verbose) {
            logCallResponse(result);
            logTransferEvent(event);
        }

        if (op.expected.events.length === 1) {
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
            const expectedEvent = parseExpectedEvent(
                op.expected.events[0],
            ) as ExpectedTransferEvent;
            expectedEvent.validate(event);
            if (this.verbose) {
                Blockchain.log(`Validating events completed`);
            }
        }
    }

    public async createPool(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const floorPrice = BigInt(op.parameters['floorPrice']);
        const initialLiquidity = BigInt(op.parameters['initialLiquidity']);
        const receiver = op.parameters['receiver']; // Address.from (USE address.toOriginalPublicKey() when exporting!!!)
        const antiBotEnabledFor = parseInt(op.parameters['antiBotEnabledFor']);
        const antiBotMaximumTokensPerReservation = BigInt(
            op.parameters['antiBotMaximumTokensPerReservation'],
        );
        const maxReservesIn5BlocksPercent = parseInt(op.parameters['maxReservesIn5BlocksPercent']);

        if (this.verbose) {
            logAction(`createPool`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`floorPrice`, floorPrice.toString());
            logParameter(`initialLiquidity`, initialLiquidity.toString());
            logParameter(`receiver`, receiver);
            logParameter(`antiBotEnabledFor`, antiBotEnabledFor.toString());
            logParameter(
                `antiBotMaximumTokensPerReservation`,
                antiBotMaximumTokensPerReservation.toString(),
            );
            logParameter(`maxReservesIn5BlocksPercent`, maxReservesIn5BlocksPercent.toString());
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.createPool({
            token: token.address,
            floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: receiver, // must be an Address now.
            network: Blockchain.network,
            antiBotEnabledFor: antiBotEnabledFor,
            antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: maxReservesIn5BlocksPercent,
        });

        Assert.expect(result.response.events.length).toEqual(2);

        const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
            result.response.events[0].data,
        );

        const liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
            result.response.events[1].data,
        );

        if (this.verbose) {
            logCreatePoolResult(result);
            logTransferEvent(transferEvent);
            logLiquidityListedEvent(liquidityListedEvent);
        }

        if (op.expected.events.length === 2) {
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
            const expectedEvent1 = parseExpectedEvent(
                op.expected.events[0],
            ) as ExpectedTransferEvent;
            expectedEvent1.validate(transferEvent);

            const expectedEvent2 = parseExpectedEvent(
                op.expected.events[1],
            ) as ExpectedLiquidityListedEvent;
            expectedEvent2.validate(liquidityListedEvent);
            if (this.verbose) {
                Blockchain.log(`Validating events completed`);
            }
        }

        await this.recordQuoteCandle(tokenName);
    }

    public async createPoolWithSignature(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const signature = op.parameters['signature'];
        const amount = BigInt(op.parameters['amount']);
        const nonce = BigInt(op.parameters['nonce']);
        const floorPrice = BigInt(op.parameters['floorPrice']);
        const initialLiquidity = BigInt(op.parameters['initialLiquidity']);
        const receiver = op.parameters['receiver']; // Address.from
        const antiBotEnabledFor = parseInt(op.parameters['antiBotEnabledFor']);
        const antiBotMaximumTokensPerReservation = BigInt(
            op.parameters['antiBotMaximumTokensPerReservation'],
        );
        const maxReservesIn5BlocksPercent = parseInt(op.parameters['maxReservesIn5BlocksPercent']);

        if (this.verbose) {
            logAction(`createPool`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`signature`, signature);
            logParameter(`amount`, amount.toString());
            logParameter(`nonce`, nonce.toString());
            logParameter(`floorPrice`, floorPrice.toString());
            logParameter(`initialLiquidity`, initialLiquidity.toString());
            logParameter(`receiver`, receiver);
            logParameter(`antiBotEnabledFor`, antiBotEnabledFor.toString());
            logParameter(
                `antiBotMaximumTokensPerReservation`,
                antiBotMaximumTokensPerReservation.toString(),
            );
            logParameter(`maxReservesIn5BlocksPercent`, maxReservesIn5BlocksPercent.toString());
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.createPoolWithSignature({
            token: token.address,
            signature: this.hexToBytes(signature),
            amount: amount,
            nonce: nonce,
            floorPrice: floorPrice,
            initialLiquidity: initialLiquidity,
            receiver: receiver, // Must be an address now.
            antiBotEnabledFor: antiBotEnabledFor,
            network: Blockchain.network,
            antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: maxReservesIn5BlocksPercent,
        });

        console.log(result.response.events);

        Assert.expect(result.response.events.length).toEqual(2);

        const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
            result.response.events[0].data,
        );

        const liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
            result.response.events[1].data,
        );

        if (this.verbose) {
            logCreatePoolResult(result);
            logTransferEvent(transferEvent);
            logLiquidityListedEvent(liquidityListedEvent);
        }

        if (op.expected.events.length === 2) {
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
            const expectedEvent1 = parseExpectedEvent(
                op.expected.events[0],
            ) as ExpectedTransferEvent;
            expectedEvent1.validate(transferEvent);

            const expectedEvent2 = parseExpectedEvent(
                op.expected.events[1],
            ) as ExpectedLiquidityListedEvent;
            expectedEvent2.validate(liquidityListedEvent);
            if (this.verbose) {
                Blockchain.log(`Validating events completed`);
            }
        }

        await this.recordQuoteCandle(tokenName);
    }

    public async reserve(op: OperationDefinition): Promise<ReserveData[]> {
        const tokenName = op.parameters['tokenName'];
        const maximumAmountIn = BigInt(op.parameters['maximumAmountIn']);
        const minimumAmountOut = BigInt(op.parameters['minimumAmountOut']);
        const forLP = op.parameters['forLP'] == 'true';
        const activationDelay = parseInt(op.parameters['activationDelay']);

        if (this.verbose) {
            logAction(`reserve`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`maximumAmountIn`, maximumAmountIn.toString());
            logParameter(`minimumAmountOut`, minimumAmountOut.toString());
            logParameter(`forLP`, forLP.toString());
            logParameter(`activationDelay`, activationDelay.toString());
        }

        const mapId: string = `${tokenName}${Blockchain.msgSender.toString()}`;

        if (this._notPurgedReservations.has(mapId)) {
            this._notPurgedReservations.delete(mapId);
        }

        const token = this.getToken(tokenName);
        let reserveData: ReserveData[] = [];

        try {
            const result = await this.nativeSwap.reserve({
                token: token.address,
                maximumAmountIn: maximumAmountIn,
                minimumAmountOut: minimumAmountOut,
                activationDelay: activationDelay,
            });

            if (this.verbose) {
                logReserveResult(result);
                logReserveEvent(result.response.events);
            }

            const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
                result.response.events,
            );

            this.addToReserveExpirations(
                tokenName,
                Blockchain.msgSender.toString(),
                Blockchain.blockNumber + 6n,
            );

            const recipientsArr: Recipient[] = [];

            for (let i = 0; i < decodedReservation.recipients.length; i++) {
                reserveData.push({
                    recipient: decodedReservation.recipients[0],
                    provider: Blockchain.txOrigin,
                });

                recipientsArr.push({
                    amount: decodedReservation.recipients[i].amount,
                    address: decodedReservation.recipients[i].address,
                    providerId: decodedReservation.recipients[i].providerId,
                });
            }

            this.addToReserveRecipients(tokenName, Blockchain.msgSender.toString(), recipientsArr);

            Assert.expect(op.expected.events.length >= result.response.events.length);

            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }

            for (let i = 0; i < result.response.events.length; i++) {
                const eventReceived = result.response.events[i];

                if (eventReceived.type === 'LiquidityReserved') {
                    for (let j = 0; j < op.expected.events.length; j++) {
                        const eventExpected = op.expected.events[i];

                        if (eventExpected.eventName === 'LiquidityReservedEvent') {
                            const received = NativeSwapTypesCoders.decodeLiquidityReservedEvent(
                                eventReceived.data,
                            );
                            const expected = parseExpectedEvent(
                                op.expected.events[i],
                            ) as ExpectedLiquidityReservedEvent;
                            expected.validate(received);
                            break;
                        }
                    }
                } else if (eventReceived.type === 'ReservationCreated') {
                    for (let j = 0; j < op.expected.events.length; j++) {
                        const eventExpected = op.expected.events[i];

                        if (eventExpected.eventName === 'ReservationCreatedEvent') {
                            const received = NativeSwapTypesCoders.decodeReservationCreatedEvent(
                                eventReceived.data,
                            );
                            const expected = parseExpectedEvent(
                                op.expected.events[i],
                            ) as ExpectedReservationCreatedEvent;
                            expected.validate(received);
                            break;
                        }
                    }
                } else if (eventReceived.type === 'ReservationPurged') {
                    // do nothing for now
                } else {
                    throw new Error(`Not matching event: ${eventReceived.type}`);
                }
            }

            if (this.verbose) {
                Blockchain.log(`Validating events completed`);
            }
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes('OPNET: NATIVE_SWAP: You may not reserve at this time.')
            ) {
                this._notPurgedReservations.set(mapId, true);
            } else {
                throw error;
            }
        }

        return reserveData;
    }

    public async listLiquidity(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const amountIn = BigInt(op.parameters['amountIn']);
        const receiver = op.parameters['receiver']; // Address.from
        const priority = op.parameters['priority'] == 'true';

        if (this.verbose) {
            logAction(`listToken`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`amountIn`, amountIn.toString());
            logParameter(`receiver`, receiver);
            logParameter(`priority`, priority.toString());
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.listLiquidity({
            token: token.address,
            receiver: receiver,
            network: Blockchain.network,
            amountIn: amountIn,
            priority: priority,
            disablePriorityQueueFees: false,
        });

        if (!this._providerMap.has(tokenName)) {
            this._providerMap.set(tokenName, []);
        }

        const arr = this._providerMap.get(tokenName);
        arr?.push(Blockchain.msgSender.toString());

        const events: NetEvent[] = [];

        for (let i = 0; i < result.response.events.length; i++) {
            if (result.response.events[i].type !== 'ReservationPurged') {
                events.push(result.response.events[i]);
            }
        }

        if (priority) {
            Assert.expect(events.length).toEqual(3);

            const transferEvent1 = NativeSwapTypesCoders.decodeTransferEvent(events[0].data);

            const transferEvent2 = NativeSwapTypesCoders.decodeTransferEvent(events[1].data);

            const liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                events[2].data,
            );

            if (this.verbose) {
                logListLiquidityResult(result);
                logTransferEvent(transferEvent1);
                logTransferEvent(transferEvent2);
                logLiquidityListedEvent(liquidityListedEvent);
            }

            if (op.expected.events.length === 3) {
                if (this.verbose) {
                    Blockchain.log(`Validating ${op.expected.events.length} events`);
                }
                const expectedEvent1 = parseExpectedEvent(
                    op.expected.events[0],
                ) as ExpectedTransferEvent;
                expectedEvent1.validate(transferEvent1);

                const expectedEvent2 = parseExpectedEvent(
                    op.expected.events[1],
                ) as ExpectedTransferEvent;
                expectedEvent2.validate(transferEvent2);

                const expectedEvent3 = parseExpectedEvent(
                    op.expected.events[2],
                ) as ExpectedLiquidityListedEvent;
                expectedEvent3.validate(liquidityListedEvent);
                if (this.verbose) {
                    Blockchain.log(`Validating events completed`);
                }
            }
        } else {
            Assert.expect(events.length).toEqual(2);

            const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(events[0].data);

            const liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                events[1].data,
            );

            if (this.verbose) {
                logListLiquidityResult(result);
                logTransferEvent(transferEvent);
                logLiquidityListedEvent(liquidityListedEvent);
            }

            if (op.expected.events.length === 2) {
                if (this.verbose) {
                    Blockchain.log(`Validating ${op.expected.events.length} events`);
                }
                const expectedEvent1 = parseExpectedEvent(
                    op.expected.events[0],
                ) as ExpectedTransferEvent;
                expectedEvent1.validate(transferEvent);

                const expectedEvent2 = parseExpectedEvent(
                    op.expected.events[1],
                ) as ExpectedLiquidityListedEvent;
                expectedEvent2.validate(liquidityListedEvent);
                if (this.verbose) {
                    Blockchain.log(`Validating events completed`);
                }
            }
        }
    }

    public async swap(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const sendUTXO = op.parameters['sendUTXO'];

        if (this.verbose) {
            logAction(`swap`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`sendUTXO`, sendUTXO);
        }

        const token = this.getToken(tokenName);
        const recipientsMap = this._reserveRecipients.get(tokenName);
        const expirationsMap = this._reserveExpirations.get(tokenName);

        if (recipientsMap !== undefined) {
            if (recipientsMap.has(Blockchain.msgSender.toString())) {
                const recipientsArr = recipientsMap.get(Blockchain.msgSender.toString());
                if (sendUTXO === 'true') {
                    if (recipientsArr) {
                        this.internalCreateRecipientUTXOs(recipientsArr);
                    }
                }
                if (recipientsArr) {
                    for (const recipient of recipientsArr) {
                        this._consumedProvider.push(recipient.providerId);
                    }
                }
            }
        }

        const result = await this.nativeSwap.swap({
            token: token.address,
        });

        if (recipientsMap !== undefined) {
            if (recipientsMap.has(Blockchain.msgSender.toString())) {
                recipientsMap.delete(Blockchain.msgSender.toString());
            }
        }
        if (expirationsMap !== undefined) {
            if (expirationsMap.has(Blockchain.msgSender.toString())) {
                expirationsMap.delete(Blockchain.msgSender.toString());
            }
        }

        if (this.verbose) {
            logSwapResult(result);
            logSwapEvents(result.response.events);
        }

        for (let i = 0; i < result.response.events.length; i++) {
            if (result.response.events[i].type === 'FulfilledProvider') {
                const decoded = NativeSwapTypesCoders.decodeFulfilledProviderEvent(
                    result.response.events[i].data,
                );
                this._fulfilledProvider.push(decoded.providerId);
            }
        }

        if (op.expected.events.length > 0) {
            Assert.expect(op.expected.events.length == result.response.events.length);
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
        }

        for (let i = 0; i < op.expected.events.length; i++) {
            const eventExpected = op.expected.events[i];
            const eventReceived = result.response.events[i];

            if (eventExpected.eventName === 'TransferEvent' && eventReceived.type === 'Transfer') {
                const received = NativeSwapTypesCoders.decodeTransferEvent(eventReceived.data);
                const expected = parseExpectedEvent(op.expected.events[i]) as ExpectedTransferEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'SwapExecutedEvent' &&
                eventReceived.type === 'SwapExecuted'
            ) {
                const received = NativeSwapTypesCoders.decodeSwapExecutedEvent(eventReceived.data);
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedSwapExecutedEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'ActivateProviderEvent' &&
                eventReceived.type === 'ActivateProvider'
            ) {
                const received = NativeSwapTypesCoders.decodeActivateProviderEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedActivateProviderEvent;
                expected.validate(received);
            } else {
                throw new Error(
                    `Not matching event: ${eventExpected.eventName}, ${eventReceived.type}`,
                );
            }
        }

        if (this.verbose) {
            if (op.expected.events.length > 0) {
                Blockchain.log(`Validating events completed`);
            }
        }
    }

    public async addLiquidity(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const receiver = op.parameters['receiver'];
        const sendUTXO = op.parameters['sendUTXO'];

        if (this.verbose) {
            logAction(`addLiquidity`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`receiver`, receiver);
            logParameter(`sendUTXO`, sendUTXO);
        }

        const token = this.getToken(tokenName);
        const recipientsMap = this._reserveRecipients.get(tokenName);
        const expirationsMap = this._reserveExpirations.get(tokenName);

        if (recipientsMap !== undefined) {
            if (recipientsMap.has(Blockchain.msgSender.toString())) {
                const recipientsArr = recipientsMap.get(Blockchain.msgSender.toString());
                if (sendUTXO === 'true') {
                    if (recipientsArr) {
                        this.internalCreateRecipientUTXOs(recipientsArr);
                    }
                }
                if (recipientsArr) {
                    for (const recipient of recipientsArr) {
                        this._consumedProvider.push(recipient.providerId);
                    }
                }
            }
        }

        const result = await this.nativeSwap.addLiquidity({
            token: token.address,
            receiver: receiver,
        });

        if (recipientsMap !== undefined) {
            if (recipientsMap.has(Blockchain.msgSender.toString())) {
                recipientsMap.delete(Blockchain.msgSender.toString());
            }
        }
        if (expirationsMap !== undefined) {
            if (expirationsMap.has(Blockchain.msgSender.toString())) {
                expirationsMap.delete(Blockchain.msgSender.toString());
            }
        }

        if (this.verbose) {
            logAddLiquidityResult(result);
            logAddLiquidityEvents(result.response.events);
        }

        if (op.expected.events.length > 0) {
            Assert.expect(op.expected.events.length == result.response.events.length);
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
        }

        for (let i = 0; i < op.expected.events.length; i++) {
            const eventExpected = op.expected.events[i];
            const eventReceived = result.response.events[i];

            if (eventExpected.eventName === 'TransferEvent' && eventReceived.type === 'Transfer') {
                const received = NativeSwapTypesCoders.decodeTransferEvent(eventReceived.data);
                const expected = parseExpectedEvent(op.expected.events[i]) as ExpectedTransferEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'LiquidityAddedEvent' &&
                eventReceived.type === 'LiquidityAdded'
            ) {
                const received = NativeSwapTypesCoders.decodeLiquidityAddedEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedLiquidityAddedEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'ActivateProviderEvent' &&
                eventReceived.type === 'ActivateProvider'
            ) {
                const received = NativeSwapTypesCoders.decodeActivateProviderEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedActivateProviderEvent;
                expected.validate(received);
            } else {
                throw new Error(
                    `Not matching event: ${eventExpected.eventName}, ${eventReceived.type}`,
                );
            }
        }

        if (this.verbose) {
            if (op.expected.events.length > 0) {
                Blockchain.log(`Validating events completed`);
            }
        }
    }

    public async removeLiquidity(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];

        if (this.verbose) {
            logAction(`removeLiquidity`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.removeLiquidity({
            token: token.address,
        });

        if (this.verbose) {
            logRemoveLiquidityResult(result);
            logRemoveLiquidityEvents(result.response.events);
        }

        Assert.expect(op.expected.events.length == result.response.events.length);

        for (let i = 0; i < op.expected.events.length; i++) {
            const eventExpected = op.expected.events[i];
            const eventReceived = result.response.events[i];

            if (eventExpected.eventName === 'TransferEvent' && eventReceived.type === 'Transfer') {
                const received = NativeSwapTypesCoders.decodeTransferEvent(eventReceived.data);
                const expected = parseExpectedEvent(op.expected.events[i]) as ExpectedTransferEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'LiquidityRemovedEvent' &&
                eventReceived.type === 'LiquidityRemoved'
            ) {
                const received = NativeSwapTypesCoders.decodeLiquidityRemovedEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedLiquidityRemovedEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'ActivateProviderEvent' &&
                eventReceived.type === 'ActivateProvider'
            ) {
                const received = NativeSwapTypesCoders.decodeActivateProviderEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedActivateProviderEvent;
                expected.validate(received);
            } else {
                throw new Error(
                    `Not matching event: ${eventExpected.eventName}, ${eventReceived.type}`,
                );
            }
        }
    }

    public async cancelListing(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const providerId: string = op.parameters['providerId'];

        if (this.verbose) {
            logAction(`cancelListing`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`providerId`, providerId);
        }

        if (this._fulfilledProvider.includes(BigInt(providerId))) {
            Blockchain.log(`Provider id ${providerId} fulfilled. Cannot cancel.`);
            return;
        }

        if (this._consumedProvider.includes(providerId)) {
            Blockchain.log(`Provider id ${providerId} is providing liquidity. Cannot cancel.`);
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.cancelListing({ token: token.address });

        if (this._providerMap.has(tokenName)) {
            const arr = this._providerMap.get(tokenName);
            if (arr) {
                const index = arr.indexOf(Blockchain.msgSender.toString());
                if (index !== -1) {
                    arr.splice(index, 1);
                }
            }
        }

        const events: NetEvent[] = [];

        for (let i = 0; i < result.response.events.length; i++) {
            if (result.response.events[i].type !== 'ReservationPurged') {
                events.push(result.response.events[i]);
            }
        }

        /*
        Assert.expect(events.length).toEqual(3);

        const fulfilledProviderEvent = NativeSwapTypesCoders.decodeFulfilledProviderEvent(
            events[0].data,
        );

        const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(events[1].data);

        const listingCanceledEvent = NativeSwapTypesCoders.decodeCancelListingEvent(events[2].data);
*/

        if (this.verbose) {
            logCancelListingResult(result);
            logCancelListingEvents(result.response.events);
        }

        /*!!!
        if (op.expected.events.length === 3) {
            if (this.verbose) {
                Blockchain.log(`Validating ${op.expected.events.length} events`);
            }
            const expectedEvent1 = parseExpectedEvent(
                op.expected.events[0],
            ) as ExpectedFulfilledProviderEvent;
            expectedEvent1.validate(fulfilledProviderEvent);

            const expectedEvent2 = parseExpectedEvent(
                op.expected.events[1],
            ) as ExpectedTransferEvent;
            expectedEvent2.validate(transferEvent);

            const expectedEvent3 = parseExpectedEvent(
                op.expected.events[2],
            ) as ExpectedListingCanceledEvent;
            expectedEvent3.validate(listingCanceledEvent);

            if (this.verbose) {
                if (op.expected.events.length > 0) {
                    Blockchain.log(`Validating events completed`);
                }
            }
        }

         */
    }

    public async getReserve(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];

        if (this.verbose) {
            logAction(`getReserve`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.getReserve({ token: token.address });

        if (this.verbose) {
            logGetReserveResult(result);
        }

        for (const key in op.expected.stateCheck) {
            switch (key) {
                case 'reservedLiquidity':
                    Assert.expect(op.expected.stateCheck['reservedLiquidity']).toEqual(
                        result.reservedLiquidity.toString(),
                    );
                    break;
                case 'liquidity':
                    Assert.expect(op.expected.stateCheck['liquidity']).toEqual(
                        result.liquidity.toString(),
                    );
                    break;
                case 'virtualBTCReserve':
                    Assert.expect(op.expected.stateCheck['virtualBTCReserve']).toEqual(
                        result.virtualBTCReserve.toString(),
                    );
                    break;
                case 'virtualTokenReserve':
                    Assert.expect(op.expected.stateCheck['virtualTokenReserve']).toEqual(
                        result.virtualTokenReserve.toString(),
                    );
                    break;
                default:
                    throw new Error('Not matching key');
            }
        }
    }

    public async getReserveForChart(tokenName: string): Promise<GetReserveResult> {
        const token = this.getToken(tokenName);
        if (this.verbose) {
            logAction(`getReserve`);
            logParameter(`tokenName`, tokenName);
        }
        return await this.nativeSwap.getReserve({ token: token.address });
    }

    public async getQuoteForChart(tokenName: string, satoshisIn: bigint): Promise<GetQuoteResult> {
        if (this.verbose) {
            logAction(`getQuote`);
            logParameter(`tokenName`, tokenName);
            logParameter(`satoshisIn`, satoshisIn.toString());
        }
        const token = this.getToken(tokenName);
        return await this.nativeSwap.getQuote({ token: token.address, satoshisIn: satoshisIn });
    }

    public async getQuote(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const satoshiIn = BigInt(op.parameters['satoshiIn']);

        if (this.verbose) {
            logAction(`getQuote`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
            logParameter(`satoshiIn`, satoshiIn.toString());
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.getQuote({
            token: token.address,
            satoshisIn: satoshiIn,
        });

        if (this.verbose) {
            logGetQuoteResult(result);
        }

        for (const key in op.expected.stateCheck) {
            switch (key) {
                case 'price':
                    Assert.expect(op.expected.stateCheck['price']).toEqual(result.price.toString());
                    break;
                case 'requiredSatoshis':
                    Assert.expect(op.expected.stateCheck['requiredSatoshis']).toEqual(
                        result.requiredSatoshis.toString(),
                    );
                    break;
                case 'tokensOut':
                    Assert.expect(op.expected.stateCheck['tokensOut']).toEqual(
                        result.tokensOut.toString(),
                    );
                    break;
                case 'scale':
                    Assert.expect(op.expected.stateCheck['scale']).toEqual(result.scale.toString());
                    break;
                default:
                    throw new Error('Not matching key');
            }
        }

        await this.recordQuoteCandle(tokenName);
    }

    public async getProviderDetails(op: OperationDefinition): Promise<GetProviderDetailsResult> {
        const tokenName = op.parameters['tokenName'];
        const token = this.getToken(tokenName);

        if (this.verbose) {
            logAction(`getProviderDetails`);
            logParameter(`context`, op.context);
            logParameter(`tokenName`, tokenName);
        }

        return await this.nativeSwap.getProviderDetails({ token: token.address });
    }

    public async getProviderDetailForReport(tokenName: string): Promise<GetProviderDetailsResult> {
        const token = this.getToken(tokenName);

        return await this.nativeSwap.getProviderDetails({ token: token.address });
    }

    public createRecipientUTXOs(op: OperationDefinition): void {
        if (this.verbose) {
            logAction(`createRecipientUTXOs`);
            logParameter(`context`, op.context);
            op.recipients.forEach((recipient: Recipient): void => {
                logParameter(`address`, recipient.address);
                logParameter(`amount`, recipient.amount.toString());
                logParameter(`providerId`, recipient.providerId);
            });
        }

        createRecipientsOutput(op.recipients);
    }

    public clearExpiredReservation(): void {
        const toDelete: Map<string, string[]> = new Map<string, string[]>();

        this._reserveExpirations.forEach((map: Map<string, bigint>, tokenName: string) => {
            const blockArr: string[] = [];
            toDelete.set(tokenName, blockArr);

            map.forEach((blockNumber: bigint, key: string): void => {
                if (Blockchain.blockNumber >= blockNumber) {
                    blockArr.push(key);
                }
            });
        });

        toDelete.forEach((values: string[], key: string): void => {
            values.forEach((value: string): void => {
                if (this.verbose) {
                    Blockchain.log(`Clearing reservation for ${key}:${value}`);
                }

                const recipientsMap = this._reserveRecipients.get(key);
                const expirationsMap = this._reserveExpirations.get(key);
                recipientsMap?.delete(value);
                expirationsMap?.delete(value);
            });
        });
    }

    public cancelShouldThrow(
        tokenName: string,
        depositAddress: string,
        providerId: string,
    ): boolean {
        let result: boolean = false;
        const map = this._reserveRecipients.get(tokenName);

        if (this._fulfilledProvider.includes(BigInt(providerId))) {
            return false;
        }

        if (this._consumedProvider.includes(providerId)) {
            return true;
        }

        if (map !== undefined) {
            for (const [key, value] of map.entries()) {
                if (value) {
                    for (const recipient of value) {
                        if (recipient.address === depositAddress) {
                            result = true;
                            break;
                        }
                    }
                    if (result) {
                        break;
                    }
                }
            }
        }

        return result;
    }

    public isReservationNotPurged(op: OperationDefinition): boolean {
        const tokenName = op.parameters['tokenName'];

        const mapId: string = `${tokenName}${Blockchain.msgSender.toString()}`;

        return this._notPurgedReservations.has(mapId);
    }

    private getToken(name: string): OP20 {
        const token = this._tokens.get(name);
        if (token === undefined || !token) {
            throw new Error('Token not initialized');
        }
        return token;
    }

    private hexToBytes(hex: string): Uint8Array {
        if (hex.length % 2 !== 0) {
            throw new Error('Invalid hex string length');
        }
        const arr = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return arr;
    }

    private internalCreateRecipientUTXOs(recipients: Recipient[]): void {
        if (this.verbose) {
            logAction(`createRecipientUTXOs`);
            recipients.forEach((recipient: Recipient): void => {
                logParameter(`address`, recipient.address);
                logParameter(`amount`, recipient.amount.toString());
                logParameter(`providerId`, recipient.providerId);
            });
        }

        createRecipientsOutput(recipients);
    }

    private addToReserveRecipients(
        tokenName: string,
        sender: string,
        recipients: Recipient[],
    ): void {
        if (!this._reserveRecipients.has(tokenName)) {
            this._reserveRecipients.set(tokenName, new Map<string, Recipient[]>());
        }
        const tokenMap = this._reserveRecipients.get(tokenName);
        if (tokenMap) {
            tokenMap.set(sender, recipients);
        }
    }

    private addToReserveExpirations(tokenName: string, sender: string, blockNumber: bigint): void {
        if (!this._reserveExpirations.has(tokenName)) {
            this._reserveExpirations.set(tokenName, new Map<string, bigint>());
        }
        const tokenMap = this._reserveExpirations.get(tokenName);
        if (tokenMap) {
            tokenMap.set(sender, blockNumber);
        }
    }
}
