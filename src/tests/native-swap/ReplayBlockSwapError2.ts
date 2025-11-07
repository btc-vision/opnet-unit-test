import { Address } from '@btc-vision/transaction';
import { Blockchain, OP20, opnet, OPNetUnit, StateHandler } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { networks } from '@btc-vision/bitcoin';
//import { cleanupSwap, getStates, tokenDecimals } from './utils/UtilSwap.js';
import { BlockReplay } from '../../blocks/BlockReplay.js';
import { helper_reserve } from '../utils/OperationHelper.js';

const nativeStatesFile = './states/NativeswapStates2.json';
const motoStatesFile = './states/MotoStates.json';
const pillStatesFile = './states/PillStates.json';
const jorgeFile = './states/jorge.json';
const rFile = './states/r.json';
//const b1tStatesFile = './states/B1TStates.json';
//const ICHXFile = './states/ICHX.json';

const admin: Address = Address.fromString(
    '0x020373626d317ae8788ce3280b491068610d840c23ecb64c14075bbb9f670af52c',
);

const motoAddress: Address = Address.fromString(
    `0x95d245621dd9faca22a7294419ad3b88e7187af6fa7e7bf7acf223a016b6f953`,
);

const pillAddress: Address = Address.fromString(
    '0x4038c7b0e617f9fdc776d02cc3f62d6d0b29807c8886af55355766305c9d3af5',
);

const nativeAddy: Address = Address.fromString(
    '0x158ea7e5f16cd5b7cc5a410378944b7f0fb5e8f7312e5dba31cfa86e5c08fd28',
);

const jorgeAddress: Address = Address.fromString(
    '0xf678fb621e91eab96099e7b6d951d025d5e24beafda79f19aed6f7777a98f73d',
);

const rnd: Address = Address.fromString(
    '0xb67d7054beadd15e97b58c469333ab3d57d801ccbc598c0a46148a7619e71f4f',
);

const adminR: Address = Address.fromString(
    '0x0258b47abfa41d8946d618fe3489940b5f2bfc79b84e0f9cd3afeccf84fd25c7d4',
);

// at 4548512=>queueIndex: 3534 (4548511n ici)
// at 4548514n => queueIndex: 8644 (4548513n ici)
// at 4548543n => isActive = false

/// ---- CHECK ----
// PROBLEM AT: 4658749n
// PROBLEM AT: 4658753n

const SEARCHED_BLOCK: bigint = 4658749n;
const MAX_BLOCK_TO_REPLAY: number = 5; // replay one block from SEARCHED_BLOCK
const KEEP_NEW_STATES: boolean = false; // if true, it won't clear and load the states from the file, it will keep the new computed one.

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    Blockchain.msgSender = admin;
    Blockchain.txOrigin = admin;

    const nativeSwap: NativeSwap = new NativeSwap(admin, nativeAddy, 2_500_000_000_000_000_000n);
    Blockchain.register(nativeSwap);

    const moto: OP20 = new OP20({
        file: 'moto',
        deployer: admin,
        address: motoAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(moto);

    const pill: OP20 = new OP20({
        file: 'pill',
        deployer: admin,
        address: pillAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(pill);

    const jorge: OP20 = new OP20({
        file: 'MyToken',
        deployer: admin,
        address: jorgeAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(jorge);

    const rndt: OP20 = new OP20({
        file: 'MyToken',
        deployer: adminR,
        address: rnd,
        decimals: tokenDecimals,
    });

    Blockchain.register(rndt);

    /*const b1t: OP20 = new OP20({
        file: 'pill',
        deployer: admin,
        address: bt1Address,
        decimals: tokenDecimals,
    });

    Blockchain.register(b1t);

    const ICHX: OP20 = new OP20({
        file: 'moto2',
        deployer: admin,
        address: ICHXAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(ICHX);*/

    async function loadStates(block: bigint): Promise<void> {
        StateHandler.purgeAll();

        Blockchain.dispose();
        Blockchain.cleanup();

        cleanupSwap();

        await Blockchain.init();

        const nativeStates = await getStates(nativeStatesFile, block);
        const motoStates = await getStates(motoStatesFile, block);
        const pillStates = await getStates(pillStatesFile, block);
        const jorgeStates = await getStates(jorgeFile, block);
        const rS = await getStates(rFile, block);
        // const ICHXStates = await getStates(ICHXFile, block);

        StateHandler.overrideStates(nativeAddy, nativeStates);
        StateHandler.overrideStates(motoAddress, motoStates);
        StateHandler.overrideStates(jorgeAddress, jorgeStates);
        StateHandler.overrideStates(rnd, rS);
        //StateHandler.overrideStates(bt1Address, b1tStates);
        StateHandler.overrideStates(pillAddress, pillStates);
        //StateHandler.overrideStates(ICHXAddress, ICHXStates);

        StateHandler.overrideDeployment(nativeAddy);
        StateHandler.overrideDeployment(motoAddress);
        StateHandler.overrideDeployment(jorgeAddress);
        StateHandler.overrideDeployment(rnd);
        //StateHandler.overrideDeployment(bt1Address);
        StateHandler.overrideDeployment(pillAddress);
        //StateHandler.overrideDeployment(ICHXAddress);
    }

    vm.beforeEach(async () => {
        cleanupSwap();

        await Blockchain.init();

        Blockchain.blockNumber = SEARCHED_BLOCK + 1n;
    });

    vm.afterEach(() => {
        Blockchain.dispose();
        Blockchain.cleanup();
    });

    await vm.it('should debug', async () => {
        await Promise.resolve();

        Blockchain.blockNumber = SEARCHED_BLOCK;
        Blockchain.network = networks.testnet;

        for (let i = 0; i < MAX_BLOCK_TO_REPLAY; i++) {
            Blockchain.blockNumber += 1n;

            vm.info(`Loading block ${Blockchain.blockNumber}... Loading states...`);

            if ((i !== 0 && !KEEP_NEW_STATES) || i === 0) {
                await loadStates(Blockchain.blockNumber - 1n);
            }

            vm.info(`Replaying block ${Blockchain.blockNumber}...`);

            const block = new BlockReplay({
                blockHeight: Blockchain.blockNumber,
                ignoreUnknownContracts: true,
            });

            const ok = await block.replayBlock();
            if (!ok) {
                vm.panic(`Block ${Blockchain.blockNumber} replay failed.`);

                return;
            }

            // Simulate something at the end of the block.

            const test = await nativeSwap.getReserve({
                token: motoAddress,
            });
            console.log(test);

            const rnd = Blockchain.generateRandomAddress();
            const resp = await helper_reserve(nativeSwap, motoAddress, rnd, 1_000_000_000n, 0n);
            console.log(resp);
        }
    });
});
