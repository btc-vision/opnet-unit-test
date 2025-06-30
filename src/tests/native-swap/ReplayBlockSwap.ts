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

const admin: Address = Address.fromString(
    '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
);

const motoAddress: Address = Address.fromString(
    `0xdb944e78cada1d705af892bb0560a4a9c4b9896d64ef23dfd3870ffd5004f4f2`, //'0xdb944e78cada1d705af892bb0560a4a9c4b9896d64ef23dfd3870ffd5004f4f2',
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

const userAddress: Address = Address.fromString(
    '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
);

// at 4548512=>queueIndex: 3534 (4548511n ici)
// at 4548514n => queueIndex: 8644 (4548513n ici)
// at 4548543n => isActive = false

const SEARCHED_BLOCK: bigint = 4548511n; //4548543n;

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    Blockchain.msgSender = admin;
    Blockchain.txOrigin = admin;

    const nativeStates = getStates(nativeStatesFile, SEARCHED_BLOCK);
    const motoStates = getStates(motoStatesFile, SEARCHED_BLOCK);
    const pillStates = getStates(pillStatesFile, SEARCHED_BLOCK);
    const b1tStates = getStates(b1tStatesFile, SEARCHED_BLOCK);

    const nativeSwap: NativeSwap = new NativeSwap(admin, nativeAddy, 2_500_000_000_000_000_000n);
    Blockchain.register(nativeSwap);

    const moto: OP_20 = new OP_20({
        file: 'MyToken',
        deployer: userAddress,
        address: motoAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(moto);

    const pill: OP_20 = new OP_20({
        file: 'MyToken',
        deployer: userAddress,
        address: pillAddress,
        decimals: tokenDecimals,
    });

    Blockchain.register(pill);

    const b1t: OP_20 = new OP_20({
        file: 'MyToken',
        deployer: userAddress,
        address: bt1Address,
        decimals: tokenDecimals,
    });

    Blockchain.register(b1t);

    vm.beforeEach(async () => {
        cleanupSwap();

        await Blockchain.init();

        Blockchain.blockNumber = SEARCHED_BLOCK + 1n;

        StateHandler.overrideStates(nativeAddy, nativeStates);
        StateHandler.overrideStates(motoAddress, motoStates);
        StateHandler.overrideStates(bt1Address, bt1States);
        StateHandler.overrideStates(pillAddress, pillStates);

        StateHandler.overrideDeployment(nativeAddy);
        StateHandler.overrideDeployment(motoAddress);
        StateHandler.overrideDeployment(bt1Address);
        StateHandler.overrideDeployment(pillAddress);
    });

    vm.afterEach(() => {
        Blockchain.dispose();
        Blockchain.cleanup();
    });

    await vm.it('should debug', async () => {
        await Promise.resolve();

        Blockchain.blockNumber = SEARCHED_BLOCK + 1n;
        Blockchain.network = networks.testnet;

        const block = new BlockReplay(Blockchain.blockNumber);
        await block.replayBlock();
    });
});
