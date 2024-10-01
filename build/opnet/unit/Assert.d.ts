import { Assertion } from './Assertion.js';
export declare class Assert {
    static equal<T>(actual: T, expected: T, message?: string): void;
    static notEqual<T>(actual: T, unexpected: T, message?: string): void;
    static deepEqual<T>(actual: T, expected: T, message?: string): void;
    private static deepStrictEqual;
    static expect(actual: unknown): Assertion;
    static throws(fn: () => void, expectedError?: string | RegExp): void;
}
