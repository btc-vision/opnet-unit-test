import { Address, NetEvent } from '@btc-vision/bsi-binary';

export interface CallResponse {
    response?: Uint8Array;
    error?: Error;
    events: NetEvent[];
    callStack: Address[];

    usedGas: bigint;
}
