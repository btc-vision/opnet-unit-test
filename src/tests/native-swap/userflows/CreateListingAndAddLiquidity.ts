import { opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { ScenarioPlayer } from '../../Scenario/ScenarioPlayer.js';

await opnet('Native Swap - User flows', async (vm: OPNetUnit) => {
    vm.beforeEach(async () => {});

    vm.afterEach(() => {});

    await vm.it('should run CreateListingAndAddLiquidity correctly', async () => {
        const player = new ScenarioPlayer();
        await player.runScenarioFile('./scenarios/CreateListingAndAddLiquidity.json');
    });
});
