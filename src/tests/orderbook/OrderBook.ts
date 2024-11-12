import { Address } from '@btc-vision/transaction';
import { Blockchain } from '../../blockchain/Blockchain.js';
import { Assert } from '../../opnet/unit/Assert.js';
import { opnet, OPNetUnit } from '../../opnet/unit/OPNetUnit.js';
import { OrderBook } from '../../contracts/order-book/OrderBook.js';

const receiver: Address = Blockchain.generateRandomAddress();

await opnet('Most Basic OrderBook Unit Tests', async (vm: OPNetUnit) => {
    Blockchain.msgSender = receiver;
    Blockchain.txOrigin = receiver; // "leftmost thing in the call chain"

    await vm.it('should instantiate the order book without crashing', async () => {
        await Assert.expect(async () => {
            const orderBookAddress = Blockchain.generateRandomAddress();
            const orderBook = new OrderBook(Blockchain.txOrigin, orderBookAddress);
            Blockchain.register(orderBook);

            await orderBook.init();

            // Clean up
            orderBook.dispose();
        }).toNotThrow();
    });
});
