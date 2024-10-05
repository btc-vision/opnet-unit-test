import { Assertion } from './Assertion.js';
export declare class Assert {
    static toBeGreaterThan(actual: bigint, expected: bigint, message?: string): void;
    static toBeGreaterThanOrEqual(actual: bigint, expected: bigint, message?: string): void;
    static toBeLessThanOrEqual(actual: bigint, expected: bigint, message?: string): void;
    static equal<T>(actual: T, expected: T, message?: string): void;
    static toBeCloseTo(actual: bigint, expected: bigint, tolerance: bigint, message?: string): void;
    static notEqual<T>(actual: T, unexpected: T, message?: string): void;
    static deepEqual<T>(actual: T, expected: T, message?: string): void;
    static expect(actual: unknown): Assertion;
    static throws(fn: () => void, expectedError?: string | RegExp): void;
    private static deepStrictEqual;
}
