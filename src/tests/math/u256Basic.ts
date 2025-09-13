import { Address } from '@btc-vision/transaction';
import { Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { MathContract } from '../../contracts/math/MathContract.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('Math: u256 basics', async (vm: OPNetUnit) => {
    let token: MathContract;

    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const deployerAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new MathContract({
            file: 'MathContract',
            deployer: deployerAddress,
            address: tokenAddress,
            decimals: 18,
        });

        Blockchain.register(token);
        await token.init();

        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;
    });

    vm.afterEach(() => {
        token.dispose();

        Blockchain.dispose();
    });

    await vm.it('should calculate some gas', async () => {
        const response = await token.testSimpleStringConversion();

        console.log('response', response);
    });
});
