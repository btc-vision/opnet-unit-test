import { opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { ScenarioPlayer } from '../../Scenario/ScenarioPlayer.js';

await opnet('Native Swap - User flows - Add liquidity ', async (vm: OPNetUnit) => {
    /*
    function addressToPointerU256(address: Address, token: Address): bigint {
        const writer = new BinaryWriter(64);
        writer.writeAddress(address);
        writer.writeAddress(token);

        const reader = new BinaryReader(sha256(Buffer.from(writer.getBuffer())));
        return reader.readU256();
    }
*/
    vm.beforeEach(async () => {});

    vm.afterEach(() => {});

    await vm.it('should 111', async () => {
        /*const addresses = [];
        let token: Address | null = null;

        for (let i = 0; i < 1500; i++) {
            const a = Blockchain.generateRandomAddress();
            let providerId: bigint = 0n;

            if (i === 0) {
                token = a;
            } else if (token !== null) {
                providerId = addressToPointerU256(a, token);
            }

            addresses.push({
                address: a.toString(),
                receiver: a.p2tr(Blockchain.network),
                providerId: providerId,
            });
        }

        const jsonString = JSON.stringify(addresses, null, 2);

        fs.writeFileSync('c:/temp/randomAddresses.json', jsonString, 'utf8');
         */

        const player = new ScenarioPlayer();
        await player.runScenarioFile('c:/temp/random_operations_tests.json');
        //await player.runScenarioFile('c:/temp/expired_reservation_tests.json');
        //await player.runScenarioFile('c:/temp/initialprovider_reserve_swap_tests.json');
        //await player.runScenarioFile('c:/temp/list_and_cancel_tests.json');
        //await player.runScenarioFile('c:/temp/list_reserve_cancel_tests.json');
        //await player.runScenarioFile('c:/temp/listing_tests.json');
        //await player.runScenarioFile('c:/temp/reserve_tests.json');
    });
});
