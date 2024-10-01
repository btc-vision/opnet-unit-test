declare global {
    interface BigInt {
        toJSON(): string;
    }
}
export declare class Assertion {
    private actual;
    constructor(actual: unknown);
    toEqual(expected: unknown): void;
    toNotEqual(unexpected: unknown): void;
    toDeepEqual(expected: unknown): void;
    toBeDefined(): void;
    private deepStrictEqual;
    toThrow(expectedError?: string | RegExp): Promise<void>;
    toNotThrow(): Promise<void>;
}
