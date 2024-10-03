import { Logger } from '@btc-vision/logger';
import { Blockchain } from '../../blockchain/Blockchain.js';

export class OPNetUnit extends Logger {
    public readonly logColor = '#FFA500';
    public afterAllFunc: (() => Promise<void> | void) | null = null;
    
    private beforeEachFunc: (() => Promise<void> | void) | null = null;
    private afterEachFunc: (() => Promise<void> | void) | null = null;

    public constructor(private name: string) {
        super();
    }

    // Setters for hooks
    public beforeEach(fn: () => Promise<void> | void) {
        this.beforeEachFunc = fn;
    }

    public async beforeAll(fn: () => Promise<void> | void) {
        await fn();
    }

    public afterEach(fn: () => Promise<void> | void) {
        this.afterEachFunc = fn;
    }

    public afterAll(fn: () => Promise<void> | void) {
        this.afterAllFunc = fn;
    }

    public async runAfterAll() {
        if (this.afterAllFunc) {
            await this.afterAllFunc();
        }

        Blockchain.cleanup();
    }

    // Define the 'it' function to run individual tests
    async it(testName: string, fn: () => Promise<void> | void) {
        const fullName = `${this.name} - ${testName}`;

        // Wrap the test function to include hooks
        const wrappedFn = async () => {
            await this.runBeforeEach();
            await fn();
        };

        // Register the test
        await this.registerTest(fullName, wrappedFn);
    }

    // Run hooks
    private async runBeforeEach() {
        if (this.beforeEachFunc) {
            await this.beforeEachFunc();
        }
    }

    private async runAfterEach() {
        if (this.afterEachFunc) {
            await this.afterEachFunc();
        }
    }

    // Register tests (could be extended for reporting, etc.)
    private async registerTest(testName: string, fn: () => Promise<void> | void) {
        this.debugBright(`Running test: ${testName}`);

        const pink = this.chalk.hex('#e56ee5');
        const start = Date.now();

        try {
            await fn();

            this.success(`✔️ Test passed ${pink(`(${Date.now() - start}ms)`)}: ${testName}`);
        } catch (e) {
            this.error(`❌ Test failed ${pink(`(${Date.now() - start}ms)`)}: ${testName}`);
            this.panic(((await e) as Error).stack as string);
        } finally {
            try {
                await this.runAfterEach();
            } catch (e) {
                this.error(`❌ AfterEach failed ${pink(`(${Date.now() - start}ms)`)}: ${testName}`);
                this.panic(((await e) as Error).stack as string);
            }
        }
    }
}

export async function opnet(suiteName: string, fn: (vm: OPNetUnit) => Promise<void> | void) {
    const vm = new OPNetUnit(suiteName);

    try {
        await fn(vm);

        if (vm.runAfterAll) await vm.runAfterAll();
    } catch (e) {
        vm.error(`❌ Suite failed: ${suiteName}`);
        vm.panic(((await e) as Error).stack as string);
    }
}
