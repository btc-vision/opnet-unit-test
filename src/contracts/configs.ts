import { Address, EcKeyPair, POOL_ADDRESS_REGTEST } from '@btc-vision/transaction';
import { Network, networks } from 'bitcoinjs-lib';

// Network
export const NETWORK: Network = networks.regtest;

function rnd(): Address {
    const rndKeyPair = EcKeyPair.generateRandomKeyPair(NETWORK);
    return new Address(rndKeyPair.publicKey);
}

// Contract addresses
export const FACTORY_ADDRESS: Address = rnd();
export const POOL_ADDRESS: Address = POOL_ADDRESS_REGTEST;
export const WBTC_ADDRESS: Address = rnd();
export const MOTO_ADDRESS: Address = rnd();
export const ROUTER_ADDRESS: Address = rnd();

//console.log(Uint8Array.from(Buffer.from(POOL_ADDRESS.toHex().replace('0x', ''), 'hex')));

// Trace flags
export const TRACE_GAS: boolean = false;
export const TRACE_POINTERS: boolean = false;
export const TRACE_CALLS: boolean = false;
export const TRACE_DEPLOYMENTS: boolean = true;
export const DISABLE_REENTRANCY_GUARD: boolean = true;
