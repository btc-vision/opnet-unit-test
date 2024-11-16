import { Blockchain } from '@btc-vision/unit-test-framework';
import { Address } from '@btc-vision/transaction';

export const FACTORY_ADDRESS: Address = new Address([
    40, 10, 228, 172, 219, 50, 169, 155, 163, 235, 250, 102, 169, 29, 219, 65, 167, 183, 161, 210,
    254, 244, 21, 57, 153, 34, 205, 138, 4, 72, 92, 2,
]);

export const POOL_ADDRESS: Address = new Address([
    40, 75, 228, 172, 219, 50, 169, 155, 163, 235, 250, 102, 169, 29, 219, 65, 167, 183, 161, 210,
    254, 244, 21, 57, 153, 34, 205, 138, 4, 72, 92, 2,
]);

export const ROUTER_ADDRESS: Address = Blockchain.generateRandomAddress();
export const WBTC_ADDRESS: Address = Blockchain.generateRandomAddress();
export const MOTO_ADDRESS: Address = Blockchain.generateRandomAddress();
