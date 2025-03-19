import fs from 'fs';
import path from 'path';
import {
    OperationDefinition,
    ScenarioDefinition,
    ScenarioHelper,
    TestDefinition,
} from './ScenarioHelper.js';
import { Assert } from '@btc-vision/unit-test-framework';

export class ScenarioPlayer {
    public async runScenarioFile(jsonPath: string): Promise<void> {
        const filePath = path.resolve(jsonPath);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const scenarioData: ScenarioDefinition = JSON.parse(rawContent);

        for (const test of scenarioData.tests) {
            await this.runTest(test, scenarioData.verbose);
        }
    }

    private async runTest(test: TestDefinition, verbose: boolean): Promise<void> {
        const helper = new ScenarioHelper(verbose);

        for (const op of test.operations) {
            await this.callScenarioMethod(op, helper);
        }
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
