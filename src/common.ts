import { Blockchain } from '@btc-vision/unit-test-framework';
import { Address } from '@btc-vision/transaction';

export const FACTORY_ADDRESS: Address = Address.fromString(
    '0xe51a4cb4267c79df6627f08ab09c14441f5acd980648bd39ca6ed9b46ab1ac2d',
);

export const POOL_ADDRESS: Address = Address.fromString(
    '0x449942c77fa8ddc79c782b2258001d5d7b8565dcb9c040696170c803ea853cf1',
);

export const ROUTER_ADDRESS: Address = Blockchain.generateRandomAddress();
export const WBTC_ADDRESS: Address = Blockchain.generateRandomAddress();
export const MOTO_ADDRESS: Address = Blockchain.generateRandomAddress();
