BigInt.prototype.toJSON = function () {
    return this.toString();
};
export class Assertion {
    actual;
    constructor(actual) {
        this.actual = actual;
    }
    toEqual(expected) {
        if (this.actual !== expected) {
            throw new Error(`Expected "${String(expected)}", but got "${String(this.actual)}"`);
        }
    }
    toNotEqual(unexpected) {
        if (this.actual === unexpected) {
            throw new Error(`Expected "${String(unexpected)}" to not be equal to "${String(this.actual)}"`);
        }
    }
    toDeepEqual(expected) {
        if (!this.deepStrictEqual(this.actual, expected)) {
            throw new Error(`Expected deep equality. Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(this.actual)}`);
        }
    }
    toBeDefined() {
        if (this.actual === undefined || this.actual === null) {
            throw new Error(`Expected value to be defined`);
        }
    }
    deepStrictEqual(actual, expected) {
        if (actual === expected)
            return true;
        if (typeof actual !== 'object' ||
            typeof expected !== 'object' ||
            actual === null ||
            expected === null) {
            return false;
        }
        const actualObj = actual;
        const expectedObj = expected;
        const keysA = Object.keys(actualObj);
        const keysB = Object.keys(expectedObj);
        if (keysA.length !== keysB.length)
            return false;
        return keysA.every((key) => this.deepStrictEqual(actualObj[key], expectedObj[key]));
    }
    async toThrow(expectedError) {
        if (typeof this.actual !== 'function') {
            throw new Error('Expected actual to be a function');
        }
        let threw = false;
        let error = null;
        try {
            await this.actual();
        }
        catch (err) {
            threw = true;
            error = err;
        }
        if (!threw) {
            throw new Error(`Expected function to throw an error, but it did not.`);
        }
        if (expectedError && error instanceof Error) {
            if (typeof expectedError === 'string') {
                if (!error.message.includes(expectedError)) {
                    throw new Error(`Expected error message '${error.message}' to include '${expectedError}'`);
                }
            }
            else if (expectedError instanceof RegExp) {
                if (!expectedError.test(error.message)) {
                    throw new Error(`Expected error message '${error.message}' to match pattern '${expectedError}'`);
                }
            }
        }
    }
    async toNotThrow() {
        if (typeof this.actual !== 'function') {
            throw new Error('Expected actual to be a function');
        }
        let threw;
        try {
            await this.actual();
        }
        catch (err) {
            threw = err;
        }
        if (threw) {
            throw new Error(`Expected function not to throw an error, but it did: ${threw.stack}`);
        }
    }
}
