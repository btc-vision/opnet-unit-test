import { Logger } from '@btc-vision/logger';
import { Blockchain } from '../../blockchain/Blockchain.js';
export class OPNetUnit extends Logger {
    name;
    logColor = '#FFA500';
    afterAllFunc = null;
    beforeEachFunc = null;
    afterEachFunc = null;
    constructor(name) {
        super();
        this.name = name;
    }
    // Setters for hooks
    beforeEach(fn) {
        this.beforeEachFunc = fn;
    }
    async beforeAll(fn) {
        await fn();
    }
    afterEach(fn) {
        this.afterEachFunc = fn;
    }
    afterAll(fn) {
        this.afterAllFunc = fn;
    }
    async runAfterAll() {
        if (this.afterAllFunc) {
            await this.afterAllFunc();
        }
        Blockchain.cleanup();
    }
    // Define the 'it' function to run individual tests
    async it(testName, fn) {
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
    async runBeforeEach() {
        if (this.beforeEachFunc) {
            await this.beforeEachFunc();
        }
    }
    async runAfterEach() {
        if (this.afterEachFunc) {
            await this.afterEachFunc();
        }
    }
    // Register tests (could be extended for reporting, etc.)
    async registerTest(testName, fn) {
        this.debugBright(`Running test: ${testName}`);
        const pink = this.chalk.hex('#e56ee5');
        const start = Date.now();
        try {
            await fn();
            this.success(`✔️ Test passed ${pink(`(${Date.now() - start}ms)`)}: ${testName}`);
        }
        catch (e) {
            this.error(`❌ Test failed ${pink(`(${Date.now() - start}ms)`)}: ${testName}`);
            this.panic((await e).stack);
        }
        finally {
            try {
                await this.runAfterEach();
            }
            catch (e) {
                this.error(`❌ AfterEach failed ${pink(`(${Date.now() - start}ms)`)}: ${testName}`);
                this.panic((await e).stack);
            }
        }
    }
}
export async function opnet(suiteName, fn) {
    const vm = new OPNetUnit(suiteName);
    try {
        await fn(vm);
        if (vm.runAfterAll)
            await vm.runAfterAll();
    }
    catch (e) {
        vm.error(`❌ Suite failed: ${suiteName}`);
        vm.panic((await e).stack);
    }
}
