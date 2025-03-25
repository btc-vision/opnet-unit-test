import { Assert, Blockchain, OP_20 } from '@btc-vision/unit-test-framework';
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
import { Address } from '@btc-vision/transaction';
import { GetQuoteResult, GetReserveResult, Recipient } from '../../contracts/NativeSwapTypes.js';
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
import { ExpectedListingCanceledEvent } from './Expected/ExpectedListingCanceledEvent.js';
import { ExpectedFulfilledProviderEvent } from './Expected/ExpectedFulfilledProviderEvent.js';
import { ExpectedActivateProviderEvent } from './Expected/ExpectedActivateProviderEvent.js';

export interface OperationDefinition {
    command: string;
    parameters: Record<string, string>;
    recipients: Recipient[];
    expected: {
        throw: boolean;
        events: JSonExpectedEvent[];
        stateCheck: Record<string, string>;
    };
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
    private _tokens: Map<string, OP_20> = new Map<string, OP_20>();
    private _reserveRecipients: Map<string, Recipient[]> = new Map<string, Recipient[]>();
    private _reserveExpirations: Map<string, bigint> = new Map<string, bigint>();

    constructor(private verbose: boolean = false) {}

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

    public setBlockchainInfo(op: OperationDefinition) {
        const blockNumber = BigInt(op.parameters['blockNumber']);
        const txOrigin = Address.fromString(op.parameters['txOrigin']);
        const msgSender = Address.fromString(op.parameters['msgSender']);

        if (this.verbose) {
            logAction(`setBlockchainInfo`);
            logParameter(`blockNumber`, blockNumber.toString());
            logParameter(`txOrigin`, txOrigin.toString());
            logParameter(`msgSender`, msgSender.toString());
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

        const token = new OP_20({
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
        if (this.verbose) {
            logAction(`reset`);
        }

        if (this.nativeSwap) {
            this.nativeSwap.dispose();
        }

        this._tokens.forEach((token: OP_20) => {
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
            logParameter(`tokenName`, tokenName.toString());
            logParameter(`owner`, owner.toString());
            logParameter(`spender`, spender.toString());
            logParameter(`amount`, amount.toString());
        }

        const token = this.getToken(tokenName);
        const result = await token.approve(owner, spender, amount);

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
            logParameter(`tokenName`, tokenName.toString());
            logParameter(`from`, from.toString());
            logParameter(`to`, to.toString());
            logParameter(`amount`, amount.toString());
        }

        const token = this.getToken(tokenName);
        const result = await token.transfer(from, to, amount);

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
        const receiver = op.parameters['receiver'];
        const antiBotEnabledFor = parseInt(op.parameters['antiBotEnabledFor']);
        const antiBotMaximumTokensPerReservation = BigInt(
            op.parameters['antiBotMaximumTokensPerReservation'],
        );
        const maxReservesIn5BlocksPercent = parseInt(op.parameters['maxReservesIn5BlocksPercent']);

        if (this.verbose) {
            logAction(`createPool`);
            logParameter(`tokenName`, tokenName.toString());
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
            receiver: receiver,
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
    }

    public async createPoolWithSignature(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const signature = op.parameters['signature'];
        const amount = BigInt(op.parameters['amount']);
        const nonce = BigInt(op.parameters['nonce']);
        const floorPrice = BigInt(op.parameters['floorPrice']);
        const initialLiquidity = BigInt(op.parameters['initialLiquidity']);
        const receiver = op.parameters['receiver'];
        const antiBotEnabledFor = parseInt(op.parameters['antiBotEnabledFor']);
        const antiBotMaximumTokensPerReservation = BigInt(
            op.parameters['antiBotMaximumTokensPerReservation'],
        );
        const maxReservesIn5BlocksPercent = parseInt(op.parameters['maxReservesIn5BlocksPercent']);

        if (this.verbose) {
            logAction(`createPool`);
            logParameter(`tokenName`, tokenName.toString());
            logParameter(`signature`, signature.toString());
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
            receiver: receiver,
            antiBotEnabledFor: antiBotEnabledFor,
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
    }

    public async reserve(op: OperationDefinition): Promise<ReserveData[]> {
        const tokenName = op.parameters['tokenName'];
        const maximumAmountIn = BigInt(op.parameters['maximumAmountIn']);
        const minimumAmountOut = BigInt(op.parameters['minimumAmountOut']);
        const forLP = op.parameters['forLP'] == 'true';
        const activationDelay = parseInt(op.parameters['activationDelay']);

        if (this.verbose) {
            logAction(`reserve`);
            logParameter(`tokenName`, tokenName.toString());
            logParameter(`maximumAmountIn`, maximumAmountIn.toString());
            logParameter(`minimumAmountOut`, minimumAmountOut.toString());
            logParameter(`forLP`, forLP.toString());
            logParameter(`activationDelay`, activationDelay.toString());
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.reserve({
            token: token.address,
            maximumAmountIn: maximumAmountIn,
            forLP: forLP,
            minimumAmountOut: minimumAmountOut,
            activationDelay: activationDelay,
        });

        if (this.verbose) {
            logReserveResult(result);
            logReserveEvent(result.response.events);
        }

        let reserveData: ReserveData[] = [];

        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            result.response.events,
        );

        this._reserveExpirations.set(Blockchain.msgSender.toString(), Blockchain.blockNumber + 5n);

        const recipientsArr: Recipient[] = [];
        this._reserveRecipients.set(Blockchain.msgSender.toString(), recipientsArr);

        for (let i = 0; i < decodedReservation.recipients.length; i++) {
            reserveData.push({
                recipient: decodedReservation.recipients[0],
                provider: Blockchain.txOrigin,
            });

            recipientsArr.push({
                amount: decodedReservation.recipients[0].amount,
                address: decodedReservation.recipients[0].address,
            });
        }

        Assert.expect(op.expected.events.length == result.response.events.length);

        for (let i = 0; i < op.expected.events.length; i++) {
            const eventExpected = op.expected.events[i];
            const eventReceived = result.response.events[i];

            if (
                eventExpected.eventName === 'LiquidityReservedEvent' &&
                eventReceived.type === 'LiquidityReserved'
            ) {
                const received = NativeSwapTypesCoders.decodeLiquidityReservedEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedLiquidityReservedEvent;
                expected.validate(received);
            } else if (
                eventExpected.eventName === 'ReservationCreatedEvent' &&
                eventReceived.type === 'ReservationCreated'
            ) {
                const received = NativeSwapTypesCoders.decodeReservationCreatedEvent(
                    eventReceived.data,
                );
                const expected = parseExpectedEvent(
                    op.expected.events[i],
                ) as ExpectedReservationCreatedEvent;
                expected.validate(received);
            } else {
                throw new Error(
                    `Not matching event: ${eventExpected.eventName}, ${eventReceived.type}`,
                );
            }
        }

        return reserveData;
    }

    public async listLiquidity(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const amountIn = BigInt(op.parameters['amountIn']);
        const receiver = op.parameters['receiver'];
        const priority = op.parameters['priority'] == 'true';

        if (this.verbose) {
            logAction(`listToken`);
            logParameter(`tokenName`, tokenName.toString());
            logParameter(`amountIn`, amountIn.toString());
            logParameter(`receiver`, receiver);
            logParameter(`priority`, priority.toString());
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.listLiquidity({
            token: token.address,
            receiver: receiver,
            amountIn: amountIn,
            priority: priority,
            disablePriorityQueueFees: false,
        });

        if (priority) {
            Assert.expect(result.response.events.length).toEqual(3);

            const transferEvent1 = NativeSwapTypesCoders.decodeTransferEvent(
                result.response.events[0].data,
            );

            const transferEvent2 = NativeSwapTypesCoders.decodeTransferEvent(
                result.response.events[1].data,
            );

            const liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                result.response.events[2].data,
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
            Assert.expect(result.response.events.length).toEqual(2);

            const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
                result.response.events[0].data,
            );

            const liquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
                result.response.events[1].data,
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
            logParameter(`tokenName`, tokenName);
            logParameter(`sendUTXO`, sendUTXO);
        }

        const token = this.getToken(tokenName);

        if (this._reserveRecipients.has(Blockchain.msgSender.toString())) {
            if (sendUTXO === 'true') {
                const recipientsArr = this._reserveRecipients.get(Blockchain.msgSender.toString());
                if (recipientsArr) {
                    this.internalCreateRecipientUTXOs(recipientsArr);
                }
            }

            this._reserveRecipients.delete(Blockchain.msgSender.toString());
            this._reserveExpirations.delete(Blockchain.msgSender.toString());
        }

        const result = await this.nativeSwap.swap({
            token: token.address,
        });

        if (this.verbose) {
            logSwapResult(result);
            logSwapEvents(result.response.events);
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

        if (op.expected.events.length > 0) {
            Blockchain.log(`Validating events completed`);
        }
    }

    public async addLiquidity(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const receiver = op.parameters['receiver'];

        if (this.verbose) {
            logAction(`addLiquidity`);
            logParameter(`tokenName`, tokenName);
            logParameter(`receiver`, receiver);
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.addLiquidity({
            token: token.address,
            receiver: receiver,
        });

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

        if (op.expected.events.length > 0) {
            Blockchain.log(`Validating events completed`);
        }
    }

    public async removeLiquidity(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];

        if (this.verbose) {
            logAction(`removeLiquidity`);
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
            } else {
                throw new Error(
                    `Not matching event: ${eventExpected.eventName}, ${eventReceived.type}`,
                );
            }
        }
    }

    public async cancelListing(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];

        if (this.verbose) {
            logAction(`cancelListing`);
            logParameter(`tokenName`, tokenName);
        }

        const token = this.getToken(tokenName);
        const result = await this.nativeSwap.cancelListing({ token: token.address });

        Assert.expect(result.response.events.length).toEqual(3);

        const fulfilledProviderEvent = NativeSwapTypesCoders.decodeFulfilledProviderEvent(
            result.response.events[0].data,
        );

        const transferEvent = NativeSwapTypesCoders.decodeTransferEvent(
            result.response.events[1].data,
        );

        const listingCanceledEvent = NativeSwapTypesCoders.decodeCancelListingEvent(
            result.response.events[2].data,
        );

        if (this.verbose) {
            logCancelListingResult(result);
            logCancelListingEvents(result.response.events);
        }

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
    }

    public async getReserve(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];

        if (this.verbose) {
            logAction(`getReserve`);
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
        return await this.nativeSwap.getReserve({ token: token.address });
    }

    public async getQuoteForChart(tokenName: string, satoshisIn: bigint): Promise<GetQuoteResult> {
        const token = this.getToken(tokenName);
        return await this.nativeSwap.getQuote({ token: token.address, satoshisIn: satoshisIn });
    }

    public async getQuote(op: OperationDefinition): Promise<void> {
        const tokenName = op.parameters['tokenName'];
        const satoshiIn = BigInt(op.parameters['satoshiIn']);

        if (this.verbose) {
            logAction(`getQuote`);
            logParameter(`tokenName`, tokenName.toString());
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
    }

    public createRecipientUTXOs(op: OperationDefinition): void {
        if (this.verbose) {
            logAction(`createRecipientUTXOs`);
            op.recipients.forEach((recipient: Recipient): void => {
                logParameter(`address`, recipient.address);
                logParameter(`amount`, recipient.amount.toString());
            });
        }

        createRecipientsOutput(op.recipients);
    }

    public clearExpiredReservation(): void {
        const toDelete: string[] = [];

        this._reserveExpirations.forEach((blockNumber: bigint, key: string): void => {
            if (Blockchain.blockNumber > blockNumber) {
                toDelete.push(key);
            }
        });

        toDelete.forEach((key: string): void => {
            Blockchain.log(`Clearing reservation for ${key}`);
            this._reserveRecipients.delete(key);
            this._reserveExpirations.delete(key);
        });
    }

    public providerHasReservation(depositAddress: string): boolean {
        let result: boolean = false;

        for (const [key, value] of this._reserveRecipients.entries()) {
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

        return result;
    }

    private getToken(name: string): OP_20 {
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
            });
        }

        createRecipientsOutput(recipients);
    }
}
