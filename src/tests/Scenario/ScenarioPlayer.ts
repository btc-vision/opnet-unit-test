import fs from 'fs';
import path from 'path';
import {
    OperationDefinition,
    ScenarioDefinition,
    ScenarioHelper,
    TestDefinition,
} from './ScenarioHelper.js';
import { Assert, Blockchain } from '@btc-vision/unit-test-framework';
import { logBeginSection, logEndSection } from '../utils/LoggerHelper.js';
import { Address } from '@btc-vision/transaction';

class ReserveInfo {
    public blockId: string;
    public liquidity: bigint;
    public reservedLiquidity: bigint;
    public virtualBTCReserve: bigint;
    public virtualTokenReserve: bigint;

    constructor(
        blockId: string,
        liquidity: bigint,
        reservedLiquidity: bigint,
        virtualBTCReserve: bigint,
        virtualTokenReserve: bigint,
    ) {
        this.blockId = blockId;
        this.liquidity = liquidity;
        this.reservedLiquidity = reservedLiquidity;
        this.virtualBTCReserve = virtualBTCReserve;
        this.virtualTokenReserve = virtualTokenReserve;
    }
}

class QuoteInfo {
    public blockId: string;
    public tokensOut: bigint;
    public requiredSatoshis: bigint;
    public price: bigint;
    public scale: bigint;

    constructor(
        blockId: string,
        tokensOut: bigint,
        requiredSatoshis: bigint,
        price: bigint,
        scale: bigint,
    ) {
        this.blockId = blockId;
        this.tokensOut = tokensOut;
        this.requiredSatoshis = requiredSatoshis;
        this.price = price;
        this.scale = scale;
    }
}

class ProviderDetailsInfo {
    public liquidity: string;
    public reserved: string;
    public liquidityProvided: string;
    public btcReceiver: string;
    public address: string;

    constructor(
        liquidity: string,
        reserved: string,
        liquidityProvided: string,
        btcReceiver: string,
        address: string,
    ) {
        this.liquidity = liquidity;
        this.reserved = reserved;
        this.liquidityProvided = liquidityProvided;
        this.btcReceiver = btcReceiver;
        this.address = address;
    }
}

export class ScenarioPlayer {
    public async runScenarioFile(jsonPath: string, verbose: boolean = true): Promise<void> {
        const filePath = path.resolve(jsonPath);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const scenarioData: ScenarioDefinition = JSON.parse(rawContent) as ScenarioDefinition;

        Blockchain.log(`Verbose is: ${scenarioData.verbose}`);

        for (const test of scenarioData.tests) {
            await this.runTest(test, scenarioData.verbose);
        }
    }

    private async runTest(test: TestDefinition, verbose: boolean): Promise<void> {
        const helper = new ScenarioHelper(verbose);
        logBeginSection(test.name);
        const reserveMap = new Map<string, ReserveInfo[]>();
        const quoteMap = new Map<string, QuoteInfo[]>();

        //try {
        let i: number = 0;
        let lastblock: bigint = 0n;

        Blockchain.log(`Running ${test.name}`);
        for (const op of test.operations) {
            if (Blockchain.blockNumber !== lastblock) {
                lastblock = Blockchain.blockNumber;
                i = 0;
                helper.clearExpiredReservation();
            }

            /*
            if (op.command == 'createToken') {
                if (!reserveMap.has(op.parameters['tokenName'])) {
                    reserveMap.set(op.parameters['tokenName'], []);
                }

                if (!quoteMap.has(op.parameters['tokenName'])) {
                    quoteMap.set(op.parameters['tokenName'], []);
                }
            }
*/
            await this.callScenarioMethod(op, helper, verbose);

            /*
            if (
                op.command == `reserve` ||
                op.command == `listLiquidity` ||
                op.command == `reserveLiquidity` ||
                op.command == `swap` ||
                op.command == `removeLiquidity` ||
                op.command == `addLiquidity` ||
                op.command == `cancelListing`
            ) {
                i++;

                const reserveArr = reserveMap.get(op.parameters['tokenName']);
                const quoteArr = quoteMap.get(op.parameters['tokenName']);

                if (reserveArr) {
                    reserveArr.push(
                        await this.createReserveInfo(helper, op.parameters['tokenName'], i),
                    );
                } else {
                    throw new Error(`No reserve found for ${op.parameters['tokenName']}`);
                }

                if (quoteArr) {
                    quoteArr.push(
                        await this.createQuoteInfo(helper, op.parameters['tokenName'], i),
                    );
                }
            }
            */
        }

        /*
        if (!fs.existsSync('./results')) {
            fs.mkdirSync('./results');
        }

        for (const [tokenName, reserves] of reserveMap.entries()) {
            const filePath = path.join(`./results/`, `${tokenName}_reserve.json`);
            const json = JSON.stringify(reserves, null, 2);

            fs.writeFileSync(filePath, json, 'utf8');
        }

        for (const [tokenName, quotes] of quoteMap.entries()) {
            const filePath = path.join(`./results/`, `${tokenName}_quote.json`);
            const json = JSON.stringify(quotes, null, 2);

            fs.writeFileSync(filePath, json, 'utf8');
        }

*/
        Blockchain.blockNumber = Blockchain.blockNumber + 1n;

        for (const [tokenName, providers] of helper._providerMap.entries()) {
            const filePath = path.join(`./results/`, `${tokenName}_providers.json`);
            const details: ProviderDetailsInfo[] = [];

            for (const provider of providers) {
                Blockchain.txOrigin = Address.fromString(provider);
                Blockchain.msgSender = Blockchain.txOrigin;

                const detail = await helper.getProviderDetailForReport(tokenName);
                details.push(
                    new ProviderDetailsInfo(
                        detail.liquidity.toString(),
                        detail.reserved.toString(),
                        detail.liquidityProvided.toString(),
                        detail.btcReceiver,
                        Blockchain.msgSender.toString(),
                    ),
                );
            }

            const json = JSON.stringify(details, null, 2);

            fs.writeFileSync(filePath, json, 'utf8');
        }

        Blockchain.log('reset');

        console.log('graph', JSON.stringify(helper.dataNative));

        helper.reset({
            command: 'reset',
            parameters: {},
            recipients: [],
            expected: {
                throw: false,
                events: [],
                stateCheck: {},
            },
            context: '',
        });
        //} catch (e) {
        //    throw e;
        //}

        logEndSection(test.name);
    }

    private async createReserveInfo(
        helper: ScenarioHelper,
        tokenName: string,
        index: number,
    ): Promise<ReserveInfo> {
        const result = await helper.getReserveForChart(tokenName);

        return new ReserveInfo(
            `${Blockchain.blockNumber}_${index}`,
            result.liquidity,
            result.reservedLiquidity,
            result.virtualBTCReserve,
            result.virtualTokenReserve,
        );
    }

    private async createQuoteInfo(
        helper: ScenarioHelper,
        tokenName: string,
        index: number,
    ): Promise<QuoteInfo> {
        const result = await helper.getQuoteForChart(tokenName, BigInt(1000));

        return new QuoteInfo(
            `${Blockchain.blockNumber}_${index}`,
            result.tokensOut,
            result.requiredSatoshis,
            result.price,
            result.scale,
        );
    }

    private async callScenarioMethod(
        op: OperationDefinition,
        helper: ScenarioHelper,
        verbose: boolean,
    ): Promise<void> {
        switch (op.command) {
            case 'setBlockchainInfo':
                if (op.expected.throw) {
                    await Assert.expect(() => {
                        helper.setBlockchainInfo(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`setBlockchainInfo throwed as expected`);
                    }
                } else {
                    helper.setBlockchainInfo(op);
                }
                break;
            case 'initialize':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.initialize(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`initialize throwed as expected`);
                    }
                } else {
                    await helper.initialize(op);
                }

                break;
            case 'createNativeSwapContract':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createNativeSwapContract(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`createNativeSwapContract throwed as expected`);
                    }
                } else {
                    await helper.createNativeSwapContract(op);
                }

                break;

            case 'createToken':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createToken(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`createToken throwed as expected`);
                    }
                } else {
                    await helper.createToken(op);
                }
                break;
            case 'reset':
                if (op.expected.throw) {
                    await Assert.expect(() => {
                        helper.reset(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`reset throwed as expected`);
                    }
                } else {
                    helper.reset(op);
                }

                break;
            case 'tokenApprove':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.tokenApprove(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`tokenApprove throwed as expected`);
                    }
                } else {
                    await helper.tokenApprove(op);
                }

                break;

            case 'tokenTransfer':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.tokenTransfer(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`tokenTransfer throwed as expected`);
                    }
                } else {
                    await helper.tokenTransfer(op);
                }

                break;
            case 'createPool':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createPool(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`createPool throwed as expected`);
                    }
                } else {
                    await helper.createPool(op);
                }

                break;
            case 'createPoolWithSignature':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createPoolWithSignature(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`createPoolWithSignature throwed as expected`);
                    }
                } else {
                    await helper.createPoolWithSignature(op);
                }

                break;
            case 'reserve':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.reserve(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`reserve throwed as expected`);
                    }
                } else {
                    try {
                        await helper.reserve(op);
                    } catch (error) {
                        if (
                            error instanceof Error &&
                            error.message.includes(
                                'OPNET: NATIVE_SWAP: You may not reserve at this time.',
                            )
                        ) {
                            if (verbose) {
                                Blockchain.log(`reservation not purged yet.`);
                            }
                        } else {
                            console.log('exception');
                            throw error;
                        }
                    }
                }

                break;
            case 'listLiquidity':
                /*!!!
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.listLiquidity(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`listLiquidity throwed as expected`);
                    }
                } else {
                    await helper.listLiquidity(op);
                }

                 */
                await helper.listLiquidity(op);

                break;
            case 'swap': {
                const notPurged: boolean = helper.isReservationNotPurged(op);

                if (op.expected.throw || notPurged) {
                    await Assert.expect(async () => {
                        await helper.swap(op);
                    }).toThrow();

                    if (verbose) {
                        if (notPurged) {
                            Blockchain.log(
                                `swap cannot be completed. Reservation did not complete has the previous one was not purged.`,
                            );
                        } else {
                            Blockchain.log(`swap throwed as expected`);
                        }
                    }
                } else {
                    await helper.swap(op);
                }

                break;
            }
            case 'addLiquidity':
                /*!!!
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.addLiquidity(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`addLiquidity throwed as expected`);
                    }
                } else {
                    await helper.addLiquidity(op);
                }


                 */
                break;
            case 'removeLiquidity':
                /*!!!
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.removeLiquidity(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`removeLiquidity throwed as expected`);
                    }
                } else {
                    await helper.removeLiquidity(op);
                }

                 */

                break;
            case 'cancelListing': {
                let checkThrow: boolean = op.expected.throw;
                /*!!!
                                if (!checkThrow && op.parameters['depositAddress']) {
                                    const depositAddress = op.parameters['depositAddress'];
                                    const providerId = op.parameters['providerId'];
                                    const tokenName = op.parameters['tokenName'];

                                    if (helper.cancelShouldThrow(tokenName, depositAddress, providerId)) {
                                        checkThrow = true;
                                    }
                                }
*/
                if (checkThrow) {
                    await Assert.expect(async () => {
                        await helper.cancelListing(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`cancelListing throwed as expected`);
                    }
                } else {
                    try {
                        await helper.cancelListing(op);
                    } catch (error) {
                        if (
                            error instanceof Error &&
                            error.message.includes(
                                'OPNET: NATIVE_SWAP: Someone have active reservations on your liquidity.',
                            )
                        ) {
                            if (verbose) {
                                Blockchain.log(`cancelListing throwed as expected`);
                            }
                        } else {
                            console.log('exception');
                            throw error;
                        }
                    }
                }

                break;
            }
            case 'getReserve':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.getReserve(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`getReserve throwed as expected`);
                    }
                } else {
                    await helper.getReserve(op);
                }

                break;
            case 'getQuote':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.getQuote(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`getQuote throwed as expected`);
                    }
                } else {
                    await helper.getQuote(op);
                }

                break;
            case 'getProviderDetails':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.getProviderDetails(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`getProviderDetails throwed as expected`);
                    }
                } else {
                    await helper.getProviderDetails(op);
                }
                break;
            case 'createRecipientUTXOs':
                if (op.expected.throw) {
                    await Assert.expect(() => {
                        helper.createRecipientUTXOs(op);
                    }).toThrow();
                    if (verbose) {
                        Blockchain.log(`createRecipientUTXOs throwed as expected`);
                    }
                } else {
                    helper.createRecipientUTXOs(op);
                }

                break;
            default:
                throw new Error(`Unsupported operation "${op.command}"`);
        }
    }
}
