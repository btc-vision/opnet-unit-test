import { Assertion } from './Assertion.js';

export class Assert {
    // New methods to support the assertions used in the HintHelpers tests
    static toBeGreaterThan(actual: bigint, expected: bigint, message?: string) {
        if (actual <= expected) {
            throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
        }
    }

    static toBeGreaterThanOrEqual(actual: bigint, expected: bigint, message?: string) {
        if (actual < expected) {
            throw new Error(
                message || `Expected ${actual} to be greater than or equal to ${expected}`,
            );
        }
    }

    static toBeLessThanOrEqual(actual: bigint, expected: bigint, message?: string) {
        if (actual > expected) {
            throw new Error(
                message || `Expected ${actual} to be less than or equal to ${expected}`,
            );
        }
    }

    static equal<T>(actual: T, expected: T, message?: string) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, but got ${actual}`);
        }
    }

    static toBeCloseTo(actual: bigint, expected: bigint, tolerance: bigint, message?: string) {
        if (actual < expected - tolerance || actual > expected + tolerance) {
            throw new Error(
                message ||
                    `Expected ${actual} to be close to ${expected} within a tolerance of ${tolerance}`,
            );
        }
    }

    static notEqual<T>(actual: T, unexpected: T, message?: string) {
        if (actual === unexpected) {
            throw new Error(message || `Expected ${unexpected} to not be equal to ${actual}`);
        }
    }

    static deepEqual<T>(actual: T, expected: T, message?: string) {
        if (!Assert.deepStrictEqual(actual, expected)) {
            throw new Error(message || `Expected deep equality`);
        }
    }

    static expect(actual: unknown) {
        return new Assertion(actual);
    }

    static throws(fn: () => void, expectedError?: string | RegExp) {
        let threw = false;
        let error: unknown = null;
        try {
            fn();
        } catch (err) {
            threw = true;
            error = err;
        }
        if (!threw) {
            throw new Error(`Expected function to throw an error, but it did not.`);
        }
        if (expectedError && error instanceof Error) {
            if (typeof expectedError === 'string') {
                Assert.equal(
                    error.message,
                    expectedError,
                    `Expected error message to be '${expectedError}', but got '${error.message}'`,
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

    private static deepStrictEqual(actual: unknown, expected: unknown): boolean {
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
        return keysA.every((key) => Assert.deepStrictEqual(actualObj[key], expectedObj[key]));
    }
}
