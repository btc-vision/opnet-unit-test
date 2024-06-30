import { Logger } from '@btc-vision/logger';

export class OPNetUnit extends Logger {
    public readonly logColor = '#FFA500';

    private beforeEachFunc: (() => Promise<void>) | null = null;
    private beforeAllFunc: (() => Promise<void>) | null = null;
    private afterEachFunc: (() => Promise<void>) | null = null;
    private afterAllFunc: (() => Promise<void>) | null = null;

    public constructor(private name: string) {
        super();
    }

    // Setters for hooks
    beforeEach(fn: () => Promise<void>) {
        this.beforeEachFunc = fn;
    }

    beforeAll(fn: () => Promise<void>) {
        this.beforeAllFunc = fn;
    }

    afterEach(fn: () => Promise<void>) {
        this.afterEachFunc = fn;
    }

    afterAll(fn: () => Promise<void>) {
        this.afterAllFunc = fn;
    }

    // Run hooks
    private async runBeforeEach() {
        if (this.beforeEachFunc) {
            await this.beforeEachFunc();
        }
    }

    private async runBeforeAll() {
        if (this.beforeAllFunc) {
            await this.beforeAllFunc();
        }
    }

    private async runAfterEach() {
        if (this.afterEachFunc) {
            await this.afterEachFunc();
        }
    }

    private async runAfterAll() {
        if (this.afterAllFunc) {
            await this.afterAllFunc();
        }
    }

    // Define the 'it' function to run individual tests
    async it(testName: string, fn: () => Promise<void>) {
        const fullName = `${this.name} - ${testName}`;

        // Wrap the test function to include hooks
        const wrappedFn = async () => {
            await this.runBeforeEach();
            await fn();
            await this.runAfterEach();
        };

        // Register the test
        await this.registerTest(fullName, wrappedFn);
    }

    // Register tests (could be extended for reporting, etc.)
    private async registerTest(testName: string, fn: () => Promise<void>) {
        this.debugBright(`Running test: ${testName}`);

        try {
            await this.runBeforeAll();
            await fn();

            this.success(`Test passed: ${testName}`);
        } catch (e) {
            this.error(`Test failed: ${testName}`);
            this.panic(e);
        } finally {
            await this.runAfterAll();
        }
    }
}

export function opnet(suiteName: string, fn: (vm: OPNetUnit) => void) {
    const vm = new OPNetUnit(suiteName);
    fn(vm);
}
