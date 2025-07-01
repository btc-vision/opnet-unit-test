import { Address } from '@btc-vision/transaction';
import { Blockchain, OP_20, opnet, OPNetUnit, StateHandler } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { networks } from '@btc-vision/bitcoin';
import { cleanupSwap, getStates, tokenDecimals } from './utils/UtilSwap.js';
import { BlockReplay } from '../../blocks/BlockReplay.js';

const nativeStatesFile = './states/NativeSwapStates2.json';
const motoStatesFile = './states/MotoStates2.json';
const pillStatesFile = './states/PillStates.json';
const b1tStatesFile = './states/B1TStates.json';
const ICHXFile = './states/ICHX.json';

const admin: Address = Address.fromString(
    '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
);

const motoAddress: Address = Address.fromString(
    `0xdb944e78cada1d705af892bb0560a4a9c4b9896d64ef23dfd3870ffd5004f4f2`,
);

const pillAddress: Address = Address.fromString(
    '0x7a0b58be893a250638cb2c95bf993ebe00b60779a4597b7c1ef0e76552c823ce',
);

const bt1Address: Address = Address.fromString(
    '0x83d9d8ce0135e00519dc0861f9627e109c47bb31df4a22f7ba7934315c1f277a',
);

const nativeAddy: Address = Address.fromString(
    '0xd0e91f6aafa36407a1325a13e73d9b59a14874fc5dde10b4219c3e13d42d4175',
);

const ICHXAddress: Address = Address.fromString(
    '0xb44aebe0a2e7760514d6167dca571b8c18eee82ef9232788a81891b87b95ddc2',
);

// at 4548512=>queueIndex: 3534 (4548511n ici)
// at 4548514n => queueIndex: 8644 (4548513n ici)
// at 4548543n => isActive = false

const SEARCHED_BLOCK: bigint = 4548511n; //4548543n;
const MAX_BLOCK_TO_REPLAY: number = 10; // replay one block from SEARCHED_BLOCK
const KEEP_NEW_STATES: boolean = false; // if true, it won't clear and load the states from the file, it will keep the new computed one.

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    Blockchain.msgSender = admin;
    Blockchain.txOrigin = admin;

    const nativeSwap: NativeSwap = new NativeSwap(admin, nativeAddy, 2_500_000_000_000_000_000n);
    Blockchain.register(nativeSwap);

    const moto: OP_20 = new OP_20({
        file: 'moto2',
        deployer: Address.fromString(
            '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
        ),
        address: motoAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(moto);

    const pill: OP_20 = new OP_20({
        file: 'pill',
        deployer: Address.fromString(
            '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
        ),
        address: pillAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(pill);

    const b1t: OP_20 = new OP_20({
        file: 'pill',
        deployer: Address.fromString(
            '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
        ),
        address: bt1Address,
        decimals: tokenDecimals,
    });

    Blockchain.register(b1t);

    const ICHX: OP_20 = new OP_20({
        file: 'moto2',
        deployer: Address.fromString(
            '0x02bc0f338bb90e546ef42826d8e4d9f272d145ca3a077af2d33d61487b2b0e7934',
        ),
        address: ICHXAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(ICHX);

    async function loadStates(block: bigint): Promise<void> {
        StateHandler.purgeAll();

        Blockchain.dispose();
        Blockchain.cleanup();

        cleanupSwap();

        await Blockchain.init();

        const nativeStates = await getStates(nativeStatesFile, block);
        const motoStates = await getStates(motoStatesFile, block);
        const pillStates = await getStates(pillStatesFile, block);
        const b1tStates = await getStates(b1tStatesFile, block);
        const ICHXStates = await getStates(ICHXFile, block);

        StateHandler.overrideStates(nativeAddy, nativeStates);
        StateHandler.overrideStates(motoAddress, motoStates);
        StateHandler.overrideStates(bt1Address, b1tStates);
        StateHandler.overrideStates(pillAddress, pillStates);
        StateHandler.overrideStates(ICHXAddress, ICHXStates);

        StateHandler.overrideDeployment(nativeAddy);
        StateHandler.overrideDeployment(motoAddress);
        StateHandler.overrideDeployment(bt1Address);
        StateHandler.overrideDeployment(pillAddress);
        StateHandler.overrideDeployment(ICHXAddress);
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
        }
    });
});
