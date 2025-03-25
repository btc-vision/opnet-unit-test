import { opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { ScenarioPlayer } from '../../Scenario/ScenarioPlayer.js';

await opnet('Native Swap - User flows - Add liquidity ', async (vm: OPNetUnit) => {
    vm.beforeEach(async () => {});

    vm.afterEach(() => {});

    await vm.it('should run scenario2 correctly', async () => {
        const player = new ScenarioPlayer();
        await player.runScenarioFile('./scenarios/scenario1.json');
    });
});
