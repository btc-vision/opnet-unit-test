export abstract class BaseExpectedEvent<T> {
    public readonly eventName: string;

    constructor(eventName: string) {
        this.eventName = eventName;
    }

    public abstract validate(srcEvent: T): void;
}
