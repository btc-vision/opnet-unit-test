import { opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { ScenarioPlayer } from '../../Scenario/ScenarioPlayer.js';

await opnet('Native Swap - User flows - Add liquidity ', async (vm: OPNetUnit) => {
    vm.beforeEach(async () => {});

    vm.afterEach(() => {});

    await vm.it('should 111', async () => {
        /*const addresses = [];
        for (let i = 0; i < 1500; i++) {
            const a = Blockchain.generateRandomAddress();

            addresses.push({
                address: a.toString(),
                receiver: a.p2tr(Blockchain.network),
            });
        }

        const jsonString = JSON.stringify(addresses, null, 2);

        fs.writeFileSync('c:/temp/randomAddresses.json', jsonString, 'utf8');


         */
        const player = new ScenarioPlayer();
        //await player.runScenarioFile('c:/temp/listing_tests.json');

        await player.runScenarioFile('c:/temp/initialprovider_reserve_swap_tests.json');
    });
});
