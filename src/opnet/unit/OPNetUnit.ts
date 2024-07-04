import { Logger } from '@btc-vision/logger';

export class OPNetUnit extends Logger {
    public readonly logColor = '#FFA500';

    private beforeEachFunc: (() => Promise<void>) | null = null;
    private afterEachFunc: (() => Promise<void>) | null = null;
    public afterAllFunc: (() => Promise<void>) | null = null;

    public constructor(private name: string) {
        super();
    }

    // Setters for hooks
    beforeEach(fn: () => Promise<void>) {
        this.beforeEachFunc = fn;
    }

    async beforeAll(fn: () => Promise<void>) {
        await fn();
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
            //await this.runAfterEach();
        };

        // Register the test
        await this.registerTest(fullName, wrappedFn);
    }

    // Register tests (could be extended for reporting, etc.)
    private async registerTest(testName: string, fn: () => Promise<void>) {
        this.debugBright(`Running test: ${testName}`);

        try {
            await fn();

            this.success(`✔️ Test passed: ${testName}`);
        } catch (e) {
            this.error(`❌ Test failed: ${testName}`);
            this.panic((await e) as Error);
        } finally {
            await this.runAfterAll();
        }

        await this.runAfterEach();
    }
}

export async function opnet(suiteName: string, fn: (vm: OPNetUnit) => Promise<void>) {
    const vm = new OPNetUnit(suiteName);

    await fn(vm);

    if (vm.afterAllFunc) await vm.afterAllFunc();
}
