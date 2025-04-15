import { Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/transaction';
import { sha256 } from '@btc-vision/bitcoin';
import { ScenarioPlayer } from '../../Scenario/ScenarioPlayer.js';
import fs from 'fs';

await opnet('Native Swap - User flows - Add liquidity ', async (vm: OPNetUnit) => {
    function addressToPointerU256(address: Address, token: Address): bigint {
        const writer = new BinaryWriter(64);
        writer.writeAddress(address);
        writer.writeAddress(token);

        const reader = new BinaryReader(sha256(Buffer.from(writer.getBuffer())));
        return reader.readU256();
    }

    vm.beforeEach(async () => {});

    vm.afterEach(() => {});

    await vm.it('should 111', async () => {
        /*const addresses = [];
        let token1: Address = Address.fromString(
            '0xcd54accc0132eff7524963bf334f65433c28148e94d28f1a3c7d8acfafaba29d',
        );
        let token2: Address = Address.fromString(
            '0x6d389965ffd3e1f870a746ed047064240523e8f71f894acdfe27065e34342571',
        );
        let token3: Address = Address.fromString(
            '0x478b75796c39f5f8aeac142e8d8af9072a38f56c78d916b901f68d52253ef04a',
        );

        for (let i = 0; i < 10000; i++) {
            const a = Blockchain.generateRandomAddress();

            let providerId1: bigint = 0n;
            let providerId2: bigint = 0n;
            let providerId3: bigint = 0n;

            providerId1 = addressToPointerU256(a, token1);
            providerId2 = addressToPointerU256(a, token2);
            providerId3 = addressToPointerU256(a, token3);

            const providerIdMap: Record<string, string> = {};
            providerIdMap['TOTO TOKEN'] = providerId1.toString();
            providerIdMap['BABA TOKEN'] = providerId2.toString();
            providerIdMap['LULU TOKEN'] = providerId3.toString();

            addresses.push({
                address: a.toString(),
                receiver: a.p2tr(Blockchain.network),
                providerId: providerIdMap,
            });
        }

        const jsonString = JSON.stringify(addresses, null, 2);

        fs.writeFileSync('c:/temp/opnet/randomAddresses.json', jsonString, 'utf8');
*/
        const player = new ScenarioPlayer();
        //await player.runScenarioFile('c:/temp/opnet/createrandom3tokens.json');
        //await player.runScenarioFile('c:/temp/opnet/random1token.json');
        //await player.runScenarioFile('c:/temp/opnet/expired_reservation_tests.json');
        //await player.runScenarioFile('c:/temp/opnet/initialprovider_reserve_swap_tests.json');
        //await player.runScenarioFile('c:/temp/opnet/list_and_cancel_tests.json');
        //await player.runScenarioFile('c:/temp/opnet/listing_tests.json');
        //await player.runScenarioFile('c:/temp/opnet/reserve_tests.json');
        //await player.runScenarioFile('c:/temp/opnet/prioritylisting.json');
        //await player.runScenarioFile('c:/temp/opnet/random_3_tokens_withprioritylisting.json');
        //await player.runScenarioFile('c:/temp/opnet/addliquidity.json');
        //await player.runScenarioFile('c:/temp/opnet/randomfull.json');
        await player.runScenarioFile('c:/temp/opnet/CreateListingAndAddLiquidity.json');
    });
});
