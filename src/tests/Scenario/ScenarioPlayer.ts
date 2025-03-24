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

export class ScenarioPlayer {
    public async runScenarioFile(jsonPath: string): Promise<void> {
        const filePath = path.resolve(jsonPath);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const scenarioData: ScenarioDefinition = JSON.parse(rawContent) as ScenarioDefinition;

        for (const test of scenarioData.tests) {
            await this.runTest(test, scenarioData.verbose);
        }
    }

    private async runTest(test: TestDefinition, verbose: boolean): Promise<void> {
        const helper = new ScenarioHelper(verbose);
        logBeginSection(test.name);
        const reserveMap = new Map<string, ReserveInfo[]>();
        const quoteMap = new Map<string, QuoteInfo[]>();

        try {
            let i: number = 0;
            let lastblock: bigint = 0n;

            for (const op of test.operations) {
                if (Blockchain.blockNumber !== lastblock) {
                    lastblock = Blockchain.blockNumber;
                    i = 0;
                }

                if (op.command == 'createToken') {
                    if (!reserveMap.has(op.parameters['tokenName'])) {
                        reserveMap.set(op.parameters['tokenName'], []);
                    }

                    if (!quoteMap.has(op.parameters['tokenName'])) {
                        quoteMap.set(op.parameters['tokenName'], []);
                    }
                }

                await this.callScenarioMethod(op, helper);

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
            }

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
        } catch (e) {
            console.log('Error', e);

            throw e;
        }

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
    ): Promise<void> {
        switch (op.command) {
            case 'setBlockchainInfo':
                if (op.expected.throw) {
                    await Assert.expect(() => {
                        helper.setBlockchainInfo(op);
                    }).toThrow();
                } else {
                    helper.setBlockchainInfo(op);
                }
                break;
            case 'initialize':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.initialize(op);
                    }).toThrow();
                } else {
                    await helper.initialize(op);
                }

                break;
            case 'createNativeSwapContract':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createNativeSwapContract(op);
                    }).toThrow();
                } else {
                    await helper.createNativeSwapContract(op);
                }

                break;

            case 'createToken':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createToken(op);
                    }).toThrow();
                } else {
                    await helper.createToken(op);
                }
                break;
            case 'reset':
                if (op.expected.throw) {
                    await Assert.expect(() => {
                        helper.reset(op);
                    }).toThrow();
                } else {
                    helper.reset(op);
                }

                break;
            case 'tokenApprove':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.tokenApprove(op);
                    }).toThrow();
                } else {
                    await helper.tokenApprove(op);
                }

                break;

            case 'tokenTransfer':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.tokenTransfer(op);
                    }).toThrow();
                } else {
                    await helper.tokenTransfer(op);
                }

                break;
            case 'createPool':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createPool(op);
                    }).toThrow();
                } else {
                    await helper.createPool(op);
                }

                break;
            case 'createPoolWithSignature':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.createPoolWithSignature(op);
                    }).toThrow();
                } else {
                    await helper.createPoolWithSignature(op);
                }

                break;
            case 'reserve':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.reserve(op);
                    }).toThrow();
                } else {
                    await helper.reserve(op);
                }

                break;
            case 'listLiquidity':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.listLiquidity(op);
                    }).toThrow();
                } else {
                    await helper.listLiquidity(op);
                }

                break;
            case 'swap':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.swap(op);
                    }).toThrow();
                } else {
                    await helper.swap(op);
                }

                break;
            case 'addLiquidity':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.addLiquidity(op);
                    }).toThrow();
                } else {
                    await helper.addLiquidity(op);
                }

                break;
            case 'removeLiquidity':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.removeLiquidity(op);
                    }).toThrow();
                } else {
                    await helper.removeLiquidity(op);
                }

                break;
            case 'cancelListing':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.cancelListing(op);
                    }).toThrow();
                } else {
                    await helper.cancelListing(op);
                }

                break;
            case 'getReserve':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.getReserve(op);
                    }).toThrow();
                } else {
                    await helper.getReserve(op);
                }

                break;
            case 'getQuote':
                if (op.expected.throw) {
                    await Assert.expect(async () => {
                        await helper.getQuote(op);
                    }).toThrow();
                } else {
                    await helper.getQuote(op);
                }

                break;

            case 'createRecipientUTXOs':
                if (op.expected.throw) {
                    await Assert.expect(() => {
                        helper.createRecipientUTXOs(op);
                    }).toThrow();
                } else {
                    helper.createRecipientUTXOs(op);
                }

                break;
            default:
                throw new Error(`Unsupported operation "${op.command}"`);
        }
    }
}
