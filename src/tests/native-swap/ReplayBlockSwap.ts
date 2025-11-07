import { Address } from '@btc-vision/transaction';
import {
    Blockchain,
    BytecodeManager,
    FastBigIntMap,
    OP20,
    opnet,
    OPNetUnit,
    StateHandler,
} from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { networks } from '@btc-vision/bitcoin';
import { BlockReplay } from '../../blocks/BlockReplay.js';
import { cleanupSwap, getStates, tokenDecimals } from '../utils/UtilsSwap.js';
import { ContractRuntime } from '@btc-vision/unit-test-framework/build/opnet/modules/ContractRuntime.js';

// Contract type enum for clarity
enum ContractType {
    OP20 = 'OP20',
    NativeSwap = 'NativeSwap',
    Custom = 'Custom',
}

// Base contract interface
interface BaseContract {
    address: Address;
    [key: string]: unknown;
}

// State object interface
interface StateObject {
    [key: string]: unknown;
}

// Contract configuration interface
interface ContractConfig {
    address: string;
    type: ContractType;
    name?: string; // Optional friendly name for logging
    deployer?: string; // Optional, defaults to admin
    decimals?: number; // For OP20 tokens
    customFactory?: (address: Address, deployer: Address) => ContractRuntime; // For custom contract types
    initParams?: unknown[]; // Additional initialization parameters
}

// Contract manager class to handle all the boilerplate
class ContractManager {
    private admin: Address;
    private contracts: Map<string, ContractRuntime> = new Map();
    private configs: ContractConfig[] = [];
    private statesCache: Map<string, FastBigIntMap> = new Map();

    constructor(adminAddress: string, contracts: ContractConfig[]) {
        this.admin = Address.fromString(adminAddress);
        this.configs = contracts;
    }

    // Initialize all contracts automatically
    initialize(): void {
        for (const config of this.configs) {
            const address = Address.fromString(config.address);
            const deployer = config.deployer ? Address.fromString(config.deployer) : this.admin;

            let contract: ContractRuntime;

            switch (config.type) {
                case ContractType.OP20:
                    contract = new OP20({
                        file: address.p2op(Blockchain.network),
                        deployer,
                        address,
                        decimals: config.decimals || tokenDecimals,
                    });
                    break;

                case ContractType.NativeSwap:
                    contract = new NativeSwap(
                        deployer,
                        address,
                        ...((config.initParams as [bigint]) || [2_500_000_000_000_000_000n]),
                    );
                    break;

                case ContractType.Custom:
                    if (config.customFactory) {
                        contract = config.customFactory(address, deployer);
                    } else {
                        throw new Error(
                            `Custom factory required for ${config.name || config.address}`,
                        );
                    }
                    break;

                default:
                    throw new Error(`Unknown contract type: ${config.type}`);
            }

            BytecodeManager.loadBytecode(
                `./bytecode/${address.p2op(Blockchain.network)}.wasm`,
                contract.address,
            );

            Blockchain.register(contract);
            this.contracts.set(config.address, contract);
        }
    }

    // Load states for all contracts at once
    async loadStates(blockNumber: bigint): Promise<void> {
        StateHandler.purgeAll();
        Blockchain.dispose();
        Blockchain.cleanup();
        cleanupSwap();
        await Blockchain.init();

        for (const config of this.configs) {
            const address = Address.fromString(config.address);
            const statesFile = `./states/${address.p2op(Blockchain.network)}.json`;

            try {
                const states = await this.getOrCreateStates(statesFile, blockNumber);
                StateHandler.overrideStates(address, states);
                StateHandler.overrideDeployment(address);
            } catch (error) {
                console.warn(`Failed to load states for ${config.name || config.address}:`, error);
                // Continue with other contracts even if one fails
            }
        }
    }

    // Get a specific contract instance
    getContract<T extends ContractRuntime>(address: string): T {
        const contract = this.contracts.get(address);
        if (!contract) {
            throw new Error(`Contract not found: ${address}`);
        }

        return contract as T;
    }

    // Get all contracts
    getAllContracts(): Map<string, ContractRuntime> {
        return this.contracts;
    }

    // Cleanup all contracts
    cleanup(): void {
        this.contracts.clear();
        this.statesCache.clear();
        StateHandler.purgeAll();
        Blockchain.dispose();
        Blockchain.cleanup();
        cleanupSwap();
    }

    // Get states from cache or load from file
    private async getOrCreateStates(filepath: string, blockNumber: bigint): Promise<FastBigIntMap> {
        const cacheKey = `${filepath}_${blockNumber}`;

        if (this.statesCache.has(cacheKey)) {
            return this.statesCache.get(cacheKey) as FastBigIntMap;
        }

        const states = await getStates(filepath, blockNumber);
        this.statesCache.set(cacheKey, states);
        return states;
    }
}

// Main configuration - just add contracts here
const CONTRACTS: ContractConfig[] = [
    {
        address: '0x32d5c3490be026cda337526b72bc13036d278400ce823e29a00cb5aef15b5d53',
        type: ContractType.NativeSwap,
        name: 'NativeSwap',
        initParams: [2_500_000_000_000_000_000n],
    },
    {
        address: '0xb7e01bd7c583ef6d2e4fd0e3bb9835f275c54b5dc5af44a442b526ebaeeebfb9',
        type: ContractType.OP20,
        name: 'MOTO',
        decimals: tokenDecimals,
    },
    {
        address: '0x798dd7cd3b5818a3fcfe81420c6757d84a30e098f88cca9afb140205d24f4049',
        type: ContractType.OP20,
        name: 'Staking',
        decimals: tokenDecimals,
    },
    {
        address: '0x186f943f8b0f803be7a44fce28739ff65953cf2bd83687a392186adaf293a336',
        type: ContractType.OP20,
        name: 'PILL',
        decimals: tokenDecimals,
    },
    {
        address: '0xb65d29d27c454ff0c5b3b4200d1bb6cbb36db10ca3f2f8622e4d2c9587888cba',
        type: ContractType.OP20,
        name: 'OD',
        decimals: tokenDecimals,
    },
    {
        address: '0xb1cff60e445799e592fa6534ff1147c01f0ebf68181c5338b633da999850a6a1',
        type: ContractType.OP20,
        name: 'Noclue',
        decimals: tokenDecimals,
    },
    {
        address: '0xe12d29f947d183bda359e8ad250e7b183fbd085d2b5d3a3ccf281224277997a1',
        type: ContractType.OP20,
        name: 'Noclue2',
        decimals: tokenDecimals,
    },
];

const ADMIN_ADDRESS = '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9';
const SEARCHED_BLOCK: bigint = 19048n;
const MAX_BLOCK_TO_REPLAY: number = 3;
const KEEP_NEW_STATES: boolean = false;

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    const manager = new ContractManager(ADMIN_ADDRESS, CONTRACTS);

    Blockchain.msgSender = Address.fromString(ADMIN_ADDRESS);
    Blockchain.txOrigin = Address.fromString(ADMIN_ADDRESS);

    vm.beforeEach(async () => {
        cleanupSwap();
        await Blockchain.init();
        Blockchain.blockNumber = SEARCHED_BLOCK + 1n;
        manager.initialize();
    });

    vm.afterEach(() => {
        manager.cleanup();
    });

    await vm.it('should debug', async () => {
        Blockchain.blockNumber = SEARCHED_BLOCK;
        Blockchain.network = networks.regtest;

        const PILL = CONTRACTS[3];

        // Get contract instances with type safety
        const nativeSwap = manager.getContract<NativeSwap>(CONTRACTS[0].address);
        const moto = manager.getContract<OP20>(PILL.address);

        for (let i = 0; i < MAX_BLOCK_TO_REPLAY; i++) {
            Blockchain.blockNumber += 1n;

            vm.info(`Loading block ${Blockchain.blockNumber}...`);

            // Load states conditionally based on configuration
            if ((i !== 0 && !KEEP_NEW_STATES) || i === 0) {
                vm.info(`Loading states for block ${Blockchain.blockNumber - 1n}...`);
                await manager.loadStates(Blockchain.blockNumber - 1n);
            }

            vm.info(`Replaying block ${Blockchain.blockNumber}...`);

            const block = new BlockReplay({
                blockHeight: Blockchain.blockNumber,
                ignoreUnknownContracts: true,
            });

            // Pre-block checks
            const reservesBefore = await nativeSwap.getReserve({
                token: Address.fromString(PILL.address),
            });
            console.log('Reserves before:', reservesBefore);

            const queueDetailsBefore = await nativeSwap.getQueueDetails({
                token: Address.fromString(PILL.address),
            });
            console.log('Queue details before:', queueDetailsBefore);

            const balanceOfMoto = await moto.balanceOf(nativeSwap.address);
            console.log('MOTO balance in NativeSwap:', balanceOfMoto);

            // Replay the block
            const success = await block.replayBlock();
            if (!success) {
                vm.panic(`Block ${Blockchain.blockNumber} replay failed.`);
                return;
            }

            // Post-block checks
            const reservesAfter = await nativeSwap.getReserve({
                token: Address.fromString(PILL.address),
            });
            console.log('Reserves after:', reservesAfter);

            const queueDetailsAfter = await nativeSwap.getQueueDetails({
                token: Address.fromString(PILL.address),
            });
            console.log('Queue details after:', queueDetailsAfter);
        }
    });
});
