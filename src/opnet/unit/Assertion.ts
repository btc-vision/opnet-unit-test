// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: Unreachable code error
BigInt.prototype.toJSON = function (): string {
    return this.toString();
};

export class Assertion {
    constructor(private actual: any) {}

    toEqual(expected: any) {
        if (this.actual !== expected) {
            throw new Error(`Expected "${expected}", but got "${this.actual}"`);
        }
    }

    toNotEqual(unexpected: any) {
        if (this.actual === unexpected) {
            throw new Error(`Expected "${unexpected}" to not be equal to "${this.actual}"`);
        }
    }

    toDeepEqual(expected: any) {
        if (!this.deepStrictEqual(this.actual, expected)) {
            throw new Error(
                `Expected deep equality. Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(this.actual)}`,
            );
        }
    }

    toBeDefined() {
        if (this.actual === undefined || this.actual === null) {
            throw new Error(`Expected value to be defined`);
        }
    }

    private deepStrictEqual(actual: any, expected: any): boolean {
        if (actual === expected) return true;
        if (
            typeof actual !== 'object' ||
            typeof expected !== 'object' ||
            actual === null ||
            expected === null
        )
            return false;
        const keysA = Object.keys(actual);
        const keysB = Object.keys(expected);
        if (keysA.length !== keysB.length) return false;
        return keysA.every((key) => this.deepStrictEqual(actual[key], expected[key]));
    }

    async toThrow(expectedError?: string | RegExp): Promise<void> {
        let threw = false;
        let error = null;
        try {
            await this.actual();
        } catch (err) {
            threw = true;
            error = err;
        }
        if (!threw) {
            throw new Error(`Expected function to throw an error, but it did not.`);
        }
        if (expectedError && error instanceof Error) {
            if (typeof expectedError === 'string') {
                if (error.message.includes(expectedError)) {
                    return;
                }

                throw new Error(
                    `Expected error message '${error.message}' to include '${expectedError}'`,
                );
            } else if (expectedError instanceof RegExp) {
                if (!expectedError.test(error.message)) {
                    throw new Error(
                        `Expected error message '${error.message}' to match pattern '${expectedError}'`,
                    );
                }
            }
        }
    }

    async toNotThrow() {
        let threw: Error | undefined;
        try {
            if (typeof this.actual === 'function') {
                await this.actual();
            } else {
                throw new Error('Expected actual to be a function');
            }
        } catch (err) {
            threw = err as Error;
        }

        if (threw) {
            throw new Error(`Expected function not to throw an error, but it did: ${threw.stack}`);
        }
    }
}
