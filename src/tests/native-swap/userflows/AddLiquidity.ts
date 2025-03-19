import { Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { ScenarioPlayer } from '../../Scenario/ScenarioPlayer.js';

await opnet('Native Swap - User flows - Add liquidity ', async (vm: OPNetUnit) => {
    vm.beforeEach(async () => {});

    vm.afterEach(() => {});

    await vm.it('should 111', async () => {
        const a = Blockchain.generateRandomAddress();
        console.log(a.toString());
        console.log(a.p2tr(Blockchain.network));

        /*const writer = new BinaryWriter(
            ADDRESS_BYTE_LENGTH * 2 + U256_BYTE_LENGTH + U256_BYTE_LENGTH,
        );

        writer.writeAddress(owner);
        writer.writeAddress(spender);
        writer.writeU256(value);
        writer.writeU256(nonce);

        const hash = sha256(writer.getBuffer());
*/
        const player = new ScenarioPlayer();
        await player.runScenarioFile('c:/temp/sc4.json');
    });
});
