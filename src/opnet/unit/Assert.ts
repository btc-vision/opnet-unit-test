import { Assertion } from './Assertion.js';
import { Address } from '@btc-vision/transaction';

export class Assert {
    public static toBeGreaterThan(actual: bigint, expected: bigint, message?: string) {
        if (actual <= expected) {
            throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
        }
    }

    public static toBeGreaterThanOrEqual(actual: bigint, expected: bigint, message?: string) {
        if (actual < expected) {
            throw new Error(
                message || `Expected ${actual} to be greater than or equal to ${expected}`,
            );
        }
    }

    public static toBeLessThanOrEqual(actual: bigint, expected: bigint, message?: string) {
        if (actual > expected) {
            throw new Error(
                message || `Expected ${actual} to be less than or equal to ${expected}`,
            );
        }
    }

    public static addressArrayEqual(actual: Address[], expected: Address[], message?: string) {
        if (actual.length !== expected.length) {
            throw new Error(
                message ||
                    `Expected address array length to be ${expected.length}, but got ${actual.length}`,
            );
        }
        for (let i = 0; i < actual.length; i++) {
            if (!actual[i].equals(expected[i])) {
                throw new Error(
                    message ||
                        `Expected address array index ${i} to be ${expected[i]}, but got ${actual[i]}`,
                );
            }
        }
    }

    public static equal<T>(actual: T, expected: T, message?: string) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, but got ${actual}`);
        }
    }

    public static toBeCloseTo(
        actual: bigint,
        expected: bigint,
        tolerance: bigint,
        message?: string,
    ) {
        if (actual < expected - tolerance || actual > expected + tolerance) {
            throw new Error(
                message ||
                    `Expected ${actual} to be close to ${expected} within a tolerance of ${tolerance}`,
            );
        }
    }

    public static notEqual<T>(actual: T, unexpected: T, message?: string) {
        if (actual === unexpected) {
            throw new Error(message || `Expected ${unexpected} to not be equal to ${actual}`);
        }
    }

    public static deepEqual<T>(actual: T, expected: T, message?: string) {
        if (!Assert.deepStrictEqual(actual, expected)) {
            throw new Error(message || `Expected deep equality`);
        }
    }

    public static expect(actual: unknown) {
        return new Assertion(actual);
    }

    public static throws(fn: () => void, expectedError?: string | RegExp) {
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
