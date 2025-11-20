import { Address, Map } from '@btc-vision/transaction';
import { Blockchain, BytecodeManager, OP20, opnet, OPNetUnit, StateHandler, } from '@btc-vision/unit-test-framework';
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

// Contract configuration interface
interface ContractConfig {
    address: string;
    type: ContractType;
    name?: string; // Optional friendly name for logging
    deployer?: string; // Optional, defaults to admin
    decimals?: number; // For OP20 tokens
    customFactory?: (address: Address, deployer: Address) => ContractRuntime; // For custom contract types
    initParams?: unknown[]; // Additional initialization parameters
    overrideContract?: string;
}

// Contract manager class to handle all the boilerplate
class ContractManager {
    private readonly admin: Address;
    private contracts: Map<string, ContractRuntime> = new Map();
    private readonly configs: ContractConfig[] = [];
    private statesCache: Map<string, Map<bigint, bigint>> = new Map();

    constructor(adminAddress: string, contracts: ContractConfig[]) {
        this.admin = Address.fromString(
            adminAddress,
            '0x0000000000000000000000000000000000000000000000000000000000000000',
        );
        this.configs = contracts;
    }

    // Initialize all contracts automatically
    initialize(): void {
        for (const config of this.configs) {
            const address = Address.fromString(config.address);
            const deployer = config.deployer
                ? Address.fromString(
                      config.deployer,
                      '0x0000000000000000000000000000000000000000000000000000000000000000',
                  )
                : this.admin;

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

            if (config.overrideContract) {
                BytecodeManager.loadBytecode(
                    `./bytecode/${config.overrideContract}.wasm`,
                    contract.address,
                );
            } else {
                BytecodeManager.loadBytecode(
                    `./bytecode/${address.p2op(Blockchain.network)}.wasm`,
                    contract.address,
                );
            }

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
    private async getOrCreateStates(
        filepath: string,
        blockNumber: bigint,
    ): Promise<Map<bigint, bigint>> {
        const cacheKey = `${filepath}_${blockNumber}`;

        if (this.statesCache.has(cacheKey)) {
            return this.statesCache.get(cacheKey) as Map<bigint, bigint>;
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
        initParams: [590_000_000_000n],
        overrideContract: 'NativeSwap',
    },
    {
        address: '0xb7e01bd7c583ef6d2e4fd0e3bb9835f275c54b5dc5af44a442b526ebaeeebfb9',
        type: ContractType.OP20,
        name: 'MOTO',
        decimals: tokenDecimals,
        overrideContract: 'MyToken',
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
        overrideContract: 'pill',
    },
    {
        address: '0xb65d29d27c454ff0c5b3b4200d1bb6cbb36db10ca3f2f8622e4d2c9587888cba',
        type: ContractType.OP20,
        name: 'OD',
        decimals: tokenDecimals,
        overrideContract: 'MyToken',
    },
    {
        address: '0xb1cff60e445799e592fa6534ff1147c01f0ebf68181c5338b633da999850a6a1',
        type: ContractType.OP20,
        name: 'Noclue',
        decimals: tokenDecimals,
        overrideContract: 'MyToken',
    },
    {
        address: '0xe12d29f947d183bda359e8ad250e7b183fbd085d2b5d3a3ccf281224277997a1',
        type: ContractType.OP20,
        name: 'Noclue2',
        decimals: tokenDecimals,
        overrideContract: 'MyToken',
    },
];

const ADMIN_ADDRESS = '0xcbe1fb2adf81b16ba4afbb38743f4738ccb28170d2efc35a3ca9366ce64ea451';
const SEARCHED_BLOCK: bigint = 20307n;
const MAX_BLOCK_TO_REPLAY: number = 2;
const KEEP_NEW_STATES: boolean = true;

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    const manager = new ContractManager(ADMIN_ADDRESS, CONTRACTS);

    Blockchain.msgSender = Address.fromString(ADMIN_ADDRESS, ADMIN_ADDRESS);
    Blockchain.txOrigin = Address.fromString(ADMIN_ADDRESS, ADMIN_ADDRESS);

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

        const ODSY = CONTRACTS[4];

        // Get contract instances with type safety
        const nativeSwap = manager.getContract<NativeSwap>(CONTRACTS[0].address);
        const moto = manager.getContract<OP20>(ODSY.address);

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
            /*const reservesBefore = await nativeSwap.getReserve({
                token: Address.fromString(ODSY.address),
            });
            console.log('Reserves before:', reservesBefore);

            const queueDetailsBefore = await nativeSwap.getQueueDetails({
                token: Address.fromString(ODSY.address),
            });
            console.log('Queue details before:', queueDetailsBefore);

            const balanceOfMoto = await moto.balanceOf(nativeSwap.address);
            console.log('MOTO balance in NativeSwap:', balanceOfMoto);*/

            // Replay the block
            const success = await block.replayBlock();
            if (!success) {
                vm.panic(`Block ${Blockchain.blockNumber} replay failed.`);
                return;
            }

            const addressBefore = Blockchain.msgSender;
            const buyer = Blockchain.generateRandomAddress();
            Blockchain.msgSender = buyer;
            Blockchain.txOrigin = buyer;

            const resp = await nativeSwap.reserve({
                token: Address.fromString(ODSY.address),
                maximumAmountIn: 10_000_000n,
                minimumAmountOut: 1n,
            });

            console.log(`Reserve response for ODSY at block ${Blockchain.blockNumber}:`, resp);

            Blockchain.msgSender = addressBefore;
            Blockchain.txOrigin = addressBefore;

            // Post-block checks
            /*const reservesAfter = await nativeSwap.getReserve({
                token: Address.fromString(ODSY.address),
            });
            console.log('Reserves after:', reservesAfter);

            const queueDetailsAfter = await nativeSwap.getQueueDetails({
                token: Address.fromString(ODSY.address),
            });
            console.log('Queue details after:', queueDetailsAfter);*/
        }
    });
});
