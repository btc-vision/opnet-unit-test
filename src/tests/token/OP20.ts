import { Address } from '@btc-vision/transaction';
import { Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('Token: Test', async (vm: OPNetUnit) => {
    let token: OP20;

    const userAddress: Address = receiver;
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const deployerAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP20({
            file: 'MyToken',
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

    await vm.it('should return the token metadata', async () => {
        const metadata = await token.metadata();

        console.log('metadata', metadata);
    });
});
