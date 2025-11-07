import { Address } from '@btc-vision/transaction';
import { Blockchain, OP20, opnet, OPNetUnit, StateHandler } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { networks } from '@btc-vision/bitcoin';
import { BlockReplay } from '../../blocks/BlockReplay.js';
import { cleanupSwap, getStates, tokenDecimals } from '../utils/UtilsSwap.js';

const admin: Address = Address.fromString(
    '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
);

const motoAddress: Address = Address.fromString(
    `0xb7e01bd7c583ef6d2e4fd0e3bb9835f275c54b5dc5af44a442b526ebaeeebfb9`,
);

const pillAddress: Address = Address.fromString(
    `0x186f943f8b0f803be7a44fce28739ff65953cf2bd83687a392186adaf293a336`,
);

const odAddress: Address = Address.fromString(
    `0xb65d29d27c454ff0c5b3b4200d1bb6cbb36db10ca3f2f8622e4d2c9587888cba`,
);

const nativeAddy: Address = Address.fromString(
    '0x32d5c3490be026cda337526b72bc13036d278400ce823e29a00cb5aef15b5d53',
);

const stakingAddress: Address = Address.fromString(
    '0x798dd7cd3b5818a3fcfe81420c6757d84a30e098f88cca9afb140205d24f4049',
);

const nativeStatesFile = `./states/${nativeAddy.p2op(Blockchain.network)}.json`;
const motoStatesFile = `./states/${motoAddress.p2op(Blockchain.network)}.json`;
const stakingStatesFile = `./states/${stakingAddress.p2op(Blockchain.network)}.json`;

// at 4548512=>queueIndex: 3534 (4548511n ici)
// at 4548514n => queueIndex: 8644 (4548513n ici)
// at 4548543n => isActive = false

const SEARCHED_BLOCK: bigint = 15460n; //4548511n; //4548543n;
const MAX_BLOCK_TO_REPLAY: number = 12; // replay one block from SEARCHED_BLOCK
const KEEP_NEW_STATES: boolean = true; // if true, it won't clear and load the states from the file, it will keep the new computed one.

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    Blockchain.msgSender = admin;
    Blockchain.txOrigin = admin;

    const nativeSwap: NativeSwap = new NativeSwap(admin, nativeAddy, 2_500_000_000_000_000_000n);
    Blockchain.register(nativeSwap);

    const moto: OP20 = new OP20({
        file: motoAddress.p2op(Blockchain.network),
        deployer: admin,
        address: motoAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(moto);

    const staking: OP20 = new OP20({
        file: stakingAddress.p2op(Blockchain.network),
        deployer: admin,
        address: stakingAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(staking);

    /*const pill: OP20 = new OP20({
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

    Blockchain.register(rndt);*/

    async function loadStates(block: bigint): Promise<void> {
        StateHandler.purgeAll();

        Blockchain.dispose();
        Blockchain.cleanup();

        cleanupSwap();

        await Blockchain.init();

        const nativeStates = await getStates(nativeStatesFile, block);
        const motoStates = await getStates(motoStatesFile, block);
        const stakingStates = await getStates(stakingStatesFile, block);

        //const pillStates = await getStates(pillStatesFile, block);
        //const jorgeStates = await getStates(jorgeFile, block);
        //const rS = await getStates(rFile, block);
        // const ICHXStates = await getStates(ICHXFile, block);

        StateHandler.overrideStates(nativeAddy, nativeStates);
        StateHandler.overrideStates(motoAddress, motoStates);
        StateHandler.overrideStates(stakingAddress, stakingStates);
        //StateHandler.overrideStates(jorgeAddress, jorgeStates);
        //StateHandler.overrideStates(rnd, rS);
        //StateHandler.overrideStates(bt1Address, b1tStates);
        //StateHandler.overrideStates(pillAddress, pillStates);
        //StateHandler.overrideStates(ICHXAddress, ICHXStates);

        StateHandler.overrideDeployment(nativeAddy);
        StateHandler.overrideDeployment(motoAddress);
        StateHandler.overrideDeployment(stakingAddress);
        //StateHandler.overrideDeployment(jorgeAddress);
        //StateHandler.overrideDeployment(rnd);
        //StateHandler.overrideDeployment(bt1Address);
        //StateHandler.overrideDeployment(pillAddress);
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
        Blockchain.network = networks.regtest;

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

            const test2 = await nativeSwap.getReserve({
                token: motoAddress,
            });
            console.log('reserves', test2);

            const details2 = await nativeSwap.getQueueDetails({
                token: motoAddress,
            });
            console.log('details', details2);

            const balanceOfMoto = await moto.balanceOf(nativeSwap.address);
            console.log('balanceOfMoto', balanceOfMoto);

            const ok = await block.replayBlock();
            if (!ok) {
                vm.panic(`Block ${Blockchain.blockNumber} replay failed.`);

                return;
            }

            // Simulate something at the end of the block.

            const test = await nativeSwap.getReserve({
                token: motoAddress,
            });
            console.log('reserves', test);

            const details = await nativeSwap.getQueueDetails({
                token: motoAddress,
            });
            console.log('details', details);

            /*const rnd = Blockchain.generateRandomAddress();
            const resp = await helper_reserve(nativeSwap, motoAddress, rnd, 1_000_000_000n, 0n);
            console.log(resp);*/
        }
    });
});
