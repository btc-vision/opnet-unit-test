import { Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { Address } from '@btc-vision/transaction';
import { helper_createToken, helper_reserve, ReserveData } from '../../utils/OperationHelper.js';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { createRecipientsOutput, gas2USD } from '../../utils/TransactionUtils.js';

await opnet('Native Swap - User flows - Add liquidity ', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const userAddress: Address = Blockchain.generateRandomAddress();
    const contractAddress: Address = Blockchain.generateRandomAddress();
    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const btcReceiverAddress: string = initialLiquidityProvider.p2tr(Blockchain.network);

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        nativeSwap = new NativeSwap(userAddress, contractAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        token = await helper_createToken(userAddress, 18, 10_000_000);

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    async function reserve(amount: bigint, provider: Address): Promise<ReserveData | null> {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        await token.transfer(userAddress, provider, amount);
        await token.approve(provider, nativeSwap.address, amount);

        const reserveResult = await helper_reserve(
            nativeSwap,
            token.address,
            provider,
            amount,
            0n,
            true,
            false,
            false,
        );

        let reserveData: ReserveData | null = null;

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(
            reserveResult.response.events,
        );

        if (decoded.recipients.length) {
            reserveData = { recipient: decoded.recipients[0], provider };
        }

        return reserveData;
    }

    async function addLiquidity(reserveData: ReserveData): Promise<void> {
        Blockchain.txOrigin = reserveData.provider;
        Blockchain.msgSender = reservation.provider;

        createRecipientsOutput(reservation.r);

        await token.approve(
            reservation.a,
            nativeSwap.address,
            BitcoinUtils.expandToDecimals(1_000_000_000_000, tokenDecimals),
        );

        const s = await nativeSwap.addLiquidity({
            token: tokenAddress,
            receiver: reservation.a.p2tr(Blockchain.network),
        });

        const d = NativeSwapTypesCoders.decodeLiquidityAddedEvent(
            s.response.events[s.response.events.length - 1].data,
        );
        vm.log(
            `Added liquidity! Spent ${gas2USD(s.response.usedGas)} USD in gas, totalSatoshisSpent: ${d.totalSatoshisSpent}, totalTokensContributed: ${d.totalTokensContributed}, virtualTokenExchanged: ${d.virtualTokenExchanged}`,
        );
    }

    Blockchain.txOrigin = userAddress;
    Blockchain.msgSender = userAddress;
    toAddLiquidity = [];
});
