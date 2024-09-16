import { Logger } from '@btc-vision/logger';

export class OPNetUnit extends Logger {
    public readonly logColor = '#FFA500';

    private beforeEachFunc: (() => Promise<void> | void) | null = null;
    private afterEachFunc: (() => Promise<void> | void) | null = null;
    public afterAllFunc: (() => Promise<void> | void) | null = null;

    public constructor(private name: string) {
        super();
    }

    // Setters for hooks
    beforeEach(fn: () => Promise<void> | void) {
        this.beforeEachFunc = fn;
    }

    async beforeAll(fn: () => Promise<void> | void) {
        await fn();
    }

    afterEach(fn: () => Promise<void> | void) {
        this.afterEachFunc = fn;
    }

    afterAll(fn: () => Promise<void> | void) {
        this.afterAllFunc = fn;
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

    public async runAfterAll() {
        if (this.afterAllFunc) {
            await this.afterAllFunc();
        }
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

    // Register tests (could be extended for reporting, etc.)
    private async registerTest(testName: string, fn: () => Promise<void> | void) {
        this.debugBright(`Running test: ${testName}`);

        try {
            await fn();

            this.success(`✔️ Test passed: ${testName}`);
        } catch (e) {
            this.error(`❌ Test failed: ${testName}`);
            this.panic(((await e) as Error).stack);
        } finally {
            try {
                await this.runAfterEach();
            } catch (e) {
                this.error(`❌ AfterEach failed: ${testName}`);
                this.panic(((await e) as Error).stack);
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
        vm.panic(((await e) as Error).stack);
    }
}
