import { Address } from '@btc-vision/transaction';
import { Blockchain, OP20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';

const deployer: Address = Blockchain.generateRandomAddress();
const sender: Address = Blockchain.generateRandomAddress();
const recipient: Address = Blockchain.generateRandomAddress();

await opnet('OP20: gas measurement', async (vm: OPNetUnit) => {
    let token: OP20;

    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const transferAmount: bigint = Blockchain.expandTo18Decimals(1000);

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP20({
            file: 'MyToken',
            deployer: deployer,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        await token.mint(sender, 10_000_000);

        Blockchain.msgSender = sender;
        Blockchain.txOrigin = sender;
    });

    vm.afterEach(() => {
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should measure gas for basic transfer', async () => {
        const result = await token.safeTransfer(
            sender,
            recipient,
            transferAmount,
            new Uint8Array(),
        );

        const gasUsed = result.usedGas;

        console.log(`OP20 transfer gas used: ${gasUsed}`);
    });
});
