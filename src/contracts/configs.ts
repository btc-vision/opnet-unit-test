import { Address } from '@btc-vision/bsi-binary';
import { Network, networks } from 'bitcoinjs-lib';

// Network
export const NETWORK: Network = networks.regtest;

// Contract addresses
export const FACTORY_ADDRESS: Address = 'bcrt1q9pf9fnpch9z2qrp5e3dgr2avzu3mypq3km2k40';
export const POOL_ADDRESS: Address = 'bcrt1qg87nx9v9ln3qyadcn0llekzjn0hx8js46ztwky';
export const WBTC_ADDRESS: Address = 'bcrt1qy44f5630m4ap4mvmgqc44qh4vndaees9y30t0m';
export const MOTO_ADDRESS: Address = 'bcrt1q5txqpm5sy0s2xsprvce4ddj0088nlq8lazkd6n';
export const ROUTER_ADDRESS: Address = 'bcrt1q9yd6mk324k0q4krmlxjky0pk65ul6hkf4u35e6';

// Trace flags
export const TRACE_GAS: boolean = false;
export const TRACE_POINTERS: boolean = false;
export const TRACE_CALLS: boolean = false;
export const TRACE_DEPLOYMENTS: boolean = false;
export const DISABLE_REENTRANCY_GUARD: boolean = true;
