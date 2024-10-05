import { Assertion } from './Assertion.js';
export class Assert {
    static toBeGreaterThan(actual, expected, message) {
        if (actual <= expected) {
            throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
        }
    }
    static toBeGreaterThanOrEqual(actual, expected, message) {
        if (actual < expected) {
            throw new Error(message || `Expected ${actual} to be greater than or equal to ${expected}`);
        }
    }
    static toBeLessThanOrEqual(actual, expected, message) {
        if (actual > expected) {
            throw new Error(message || `Expected ${actual} to be less than or equal to ${expected}`);
        }
    }
    static equal(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, but got ${actual}`);
        }
    }
    static toBeCloseTo(actual, expected, tolerance, message) {
        if (actual < expected - tolerance || actual > expected + tolerance) {
            throw new Error(message ||
                `Expected ${actual} to be close to ${expected} within a tolerance of ${tolerance}`);
        }
    }
    static notEqual(actual, unexpected, message) {
        if (actual === unexpected) {
            throw new Error(message || `Expected ${unexpected} to not be equal to ${actual}`);
        }
    }
    static deepEqual(actual, expected, message) {
        if (!Assert.deepStrictEqual(actual, expected)) {
            throw new Error(message || `Expected deep equality`);
        }
    }
    static expect(actual) {
        return new Assertion(actual);
    }
    static throws(fn, expectedError) {
        let threw = false;
        let error = null;
        try {
            fn();
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
                Assert.equal(error.message, expectedError, `Expected error message to be '${expectedError}', but got '${error.message}'`);
            }
            else if (expectedError instanceof RegExp) {
                if (!expectedError.test(error.message)) {
                    throw new Error(`Expected error message '${error.message}' to match pattern '${expectedError}'`);
                }
            }
        }
    }
    static deepStrictEqual(actual, expected) {
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
        return keysA.every((key) => Assert.deepStrictEqual(actualObj[key], expectedObj[key]));
    }
}
