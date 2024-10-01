import { Logger } from '@btc-vision/logger';
export declare class OPNetUnit extends Logger {
    private name;
    readonly logColor = "#FFA500";
    afterAllFunc: (() => Promise<void> | void) | null;
    private beforeEachFunc;
    private afterEachFunc;
    constructor(name: string);
    beforeEach(fn: () => Promise<void> | void): void;
    beforeAll(fn: () => Promise<void> | void): Promise<void>;
    afterEach(fn: () => Promise<void> | void): void;
    afterAll(fn: () => Promise<void> | void): void;
    runAfterAll(): Promise<void>;
    it(testName: string, fn: () => Promise<void> | void): Promise<void>;
    private runBeforeEach;
    private runAfterEach;
    private registerTest;
}
export declare function opnet(suiteName: string, fn: (vm: OPNetUnit) => Promise<void> | void): Promise<void>;
