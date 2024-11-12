import { Address, EcKeyPair } from '@btc-vision/transaction';
import { Network, networks } from '@btc-vision/bitcoin';

// Network
export const NETWORK: Network = networks.regtest;

export function rnd(): Address {
    const rndKeyPair = EcKeyPair.generateRandomKeyPair(NETWORK);
    return new Address(rndKeyPair.publicKey);
}

// Contract addresses
export const FACTORY_ADDRESS: Address = new Address([
    40, 10, 228, 172, 219, 50, 169, 155, 163, 235, 250, 102, 169, 29, 219, 65, 167, 183, 161, 210,
    254, 244, 21, 57, 153, 34, 205, 138, 4, 72, 92, 2,
]);

export const POOL_ADDRESS: Address = new Address([
    40, 75, 228, 172, 219, 50, 169, 155, 163, 235, 250, 102, 169, 29, 219, 65, 167, 183, 161, 210,
    254, 244, 21, 57, 153, 34, 205, 138, 4, 72, 92, 2,
]);

export const WBTC_ADDRESS: Address = rnd();
export const MOTO_ADDRESS: Address = rnd();
export const ROUTER_ADDRESS: Address = rnd();

// Max call stack depth
export const MAX_CALL_STACK_DEPTH: number = 20;

//console.log(Uint8Array.from(Buffer.from(POOL_ADDRESS.toHex().replace('0x', ''), 'hex')));

// Trace flags
export const TRACE_GAS: boolean = false;
export const TRACE_POINTERS: boolean = false;
export const TRACE_CALLS: boolean = false;
export const TRACE_DEPLOYMENTS: boolean = false;
export const DISABLE_REENTRANCY_GUARD: boolean = true;
