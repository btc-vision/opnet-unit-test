import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { OP_20 } from '../contracts/OP_20.js';
import { Address } from '@btc-vision/bsi-binary';

const rndAddress = Blockchain.generateRandomSegwitAddress();
const receiver: Address = Blockchain.generateRandomTaprootAddress();

await opnet('Compare OP_20 gas usage', async (vm: OPNetUnit) => {
    await vm.it('should instantiate an OP_20 token', async () => {
        await Assert.expect(() => {
            const token = new OP_20('MyToken', Blockchain.txOrigin, rndAddress, 18);
            token.init();
            token.dispose();
        }).toNotThrow();
    });

    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    // Declare all the request contracts
    const token = new OP_20('MyToken', Blockchain.txOrigin, rndAddress, 18);
    Blockchain.register(token);

    vm.beforeEach(() => {
        Blockchain.init();
    });

    vm.afterAll(() => {
        Blockchain.dispose();
    });

    async function mintTokens() {
        await token.resetStates();

        const amountA = 11000000;

        // Mint some token
        await token.mint(receiver, amountA);

        const currentBalanceTokenA = await token.balanceOfNoDecimals(receiver);
        Assert.expect(currentBalanceTokenA).toEqual(amountA);
    }

    await vm.beforeAll(async () => {
        Blockchain.init();

        await mintTokens();
    });

    await vm.it('should get the gas of a transfer', async () => {
        const time = Date.now();
        const transfer = await token.transfer(receiver, rndAddress, 100n);
        const elapsed = Date.now() - time;
        const currentGasUsed = 574235805n; //console.log('Gas:', transfer);

        if (transfer.usedGas <= currentGasUsed) {
            const savedGas = currentGasUsed - transfer.usedGas;
            vm.success(
                `Gas used is less than or equal to the expected gas (${savedGas} gas saved)`,
            );
        } else {
            vm.error(
                `Gas used is more than the expected gas (${transfer.usedGas} > ${currentGasUsed})`,
            );
        }

        vm.info(`Elapsed time: ${elapsed}ms`);

        Assert.equal(transfer.usedGas <= currentGasUsed, true);
    });
});
