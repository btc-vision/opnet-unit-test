import { Address } from '@btc-vision/transaction';

declare global {
    interface BigInt {
        toJSON(): string;
    }
}

BigInt.prototype.toJSON = function (): string {
    return this.toString();
};

export class Assertion {
    public constructor(public actual: unknown) {}

    public toEqual(expected: unknown): void {
        if (this.actual !== expected) {
            throw new Error(`Expected "${String(expected)}", but got "${String(this.actual)}"`);
        }
    }

    public toBeUndefined(): void {
        if (this.actual !== undefined) {
            throw new Error(`Expected value to be undefined`);
        }
    }

    public toEqualAddress(address: Address): void {
        if (this.actual instanceof Address) {
            if (!this.actual.equals(address)) {
                throw new Error(
                    `Expected address "${address.toString()}", but got "${this.actual.toString()}"`,
                );
            }
        } else {
            throw new Error(`Expected address, but got "${this.actual}"`);
        }
    }

    public toNotEqual(unexpected: unknown): void {
        if (this.actual === unexpected) {
            throw new Error(
                `Expected "${String(unexpected)}" to not be equal to "${String(this.actual)}"`,
            );
        }
    }

    public toDeepEqual(expected: unknown): void {
        if (!this.deepStrictEqual(this.actual, expected)) {
            throw new Error(
                `Expected deep equality. Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(this.actual)}`,
            );
        }
    }

    public toBeDefined(): void {
        if (this.actual === undefined || this.actual === null) {
            throw new Error(`Expected value to be defined`);
        }
    }

    public async toThrow(expectedError?: string | RegExp): Promise<void> {
        if (typeof this.actual !== 'function') {
            throw new Error('Expected actual to be a function');
        }

        let threw = false;
        let error: unknown = null;
        try {
            await (this.actual as () => Promise<void>)();
        } catch (err) {
            threw = true;
            error = err;
        }
        if (!threw) {
            throw new Error(`Expected function to throw an error, but it did not.`);
        }
        if (expectedError && error instanceof Error) {
            if (typeof expectedError === 'string') {
                if (!error.message.includes(expectedError)) {
                    throw new Error(
                        `Expected error message '${error.message}' to include '${expectedError}'`,
                    );
                }
            } else if (expectedError instanceof RegExp) {
                if (!expectedError.test(error.message)) {
                    throw new Error(
                        `Expected error message '${error.message}' to match pattern '${expectedError}'`,
                    );
                }
            }
        }
    }

    public toEqualAddressList(expected: Address[]): void {
        if (!Array.isArray(this.actual)) {
            throw new Error(`Expected actual to be an array`);
        }

        if (this.actual.length !== expected.length) {
            throw new Error(
                `Expected array length to be ${expected.length}, but got ${this.actual.length}`,
            );
        }

        for (let i = 0; i < expected.length; i++) {
            const actual = this.actual[i] as Address;
            if (!actual.equals(expected[i])) {
                throw new Error(
                    `Expected address at index ${i} to be ${expected[i].toString()}, but got ${actual}`,
                );
            }
        }
    }

    public async toNotThrow(): Promise<void> {
        if (typeof this.actual !== 'function') {
            throw new Error('Expected actual to be a function');
        }
        let threw: Error | undefined;
        try {
            await (this.actual as () => Promise<void>)();
        } catch (err) {
            threw = err as Error;
        }

        if (threw) {
            throw new Error(`Expected function not to throw an error, but it did: ${threw.stack}`);
        }
    }

    private deepStrictEqual(actual: unknown, expected: unknown): boolean {
        if (actual === expected) return true;
        if (
            typeof actual !== 'object' ||
            typeof expected !== 'object' ||
            actual === null ||
            expected === null
        ) {
            return false;
        }

        const actualObj = actual as Record<string, unknown>;
        const expectedObj = expected as Record<string, unknown>;

        const keysA = Object.keys(actualObj);
        const keysB = Object.keys(expectedObj);
        if (keysA.length !== keysB.length) return false;
        return keysA.every((key) => this.deepStrictEqual(actualObj[key], expectedObj[key]));
    }
}
