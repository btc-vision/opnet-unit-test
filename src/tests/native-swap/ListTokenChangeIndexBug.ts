import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { ListLiquidityResult } from '../../contracts/NativeSwapTypes.js';
import { helper_createPool, helper_reserve, helper_swap } from '../utils/OperationHelper.js';
import { address } from '@btc-vision/bitcoin';
import { logProviderDetailsResult } from '../utils/LoggerHelper.js';
import { createRecipientUTXOs } from '../utils/UTXOSimulator.js';

async function listToken(
    nativeSwap: NativeSwap,
    token: OP_20,
    tokenAddress: Address,
    contractOwnerAddress: Address,
    lister: Address,
    amount: bigint,
): Promise<void> {
    Blockchain.txOrigin = contractOwnerAddress;
    Blockchain.msgSender = contractOwnerAddress;

    await token.transfer(contractOwnerAddress, lister, amount * 2n);

    Blockchain.txOrigin = lister;
    Blockchain.msgSender = lister;
    await token.approve(lister, nativeSwap.address, amount * 2n);

    const resp1: ListLiquidityResult = await nativeSwap.listLiquidity({
        token: tokenAddress,
        receiver: lister.p2tr(Blockchain.network),
        amountIn: amount,
        priority: false,
        disablePriorityQueueFees: false,
    });

    Assert.expect(resp1.response.error).toBeUndefined();
    const events1 = resp1.response.events;
    const LiquidityListedEvt1 = events1.find((e) => e.type === 'LiquidityListed');
    if (!LiquidityListedEvt1) {
        throw new Error('No LiquidityListed event found for normal queue');
    }
}

await opnet('NativeSwap: listLiquidity index changes bug', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const contractOwnerAddress: Address = Blockchain.generateRandomAddress();
    const stakingContractAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const nativeSwapAddress: Address = Blockchain.generateRandomAddress();

    const floorPrice: bigint = 100000000000000n;
    const initialLiquidityAmount: number = 1_000_000;
    const initialLiquidityAmountExpanded: bigint =
        Blockchain.expandTo18Decimals(initialLiquidityAmount);

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = new OP_20({
            file: 'MyToken',
            deployer: contractOwnerAddress,
            address: tokenAddress,
            decimals: 18,
        });
        Blockchain.register(token);
        await token.init();

        // Give user some extra tokens beyond the initial liquidity
        // so that subsequent "addLiquidity(...)" calls can work
        await token.mint(contractOwnerAddress, 10_000_000_000);

        nativeSwap = new NativeSwap(contractOwnerAddress, nativeSwapAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await helper_createPool(
            nativeSwap,
            token,
            contractOwnerAddress,
            contractOwnerAddress,
            initialLiquidityAmount,
            floorPrice,
            initialLiquidityAmountExpanded,
            40,
            false,
            true,
        );

        Blockchain.txOrigin = contractOwnerAddress;
        Blockchain.msgSender = contractOwnerAddress;

        await nativeSwap.setStakingContractAddress({ stakingContractAddress });
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should produce the bug', async () => {
        Blockchain.blockNumber = 1000n;
        const amountIn = Blockchain.expandTo18Decimals(500);

        const lister1 = Blockchain.generateRandomAddress();
        const lister2 = Blockchain.generateRandomAddress();
        const lister3 = Blockchain.generateRandomAddress();
        const lister4 = Blockchain.generateRandomAddress();
        const lister5 = Blockchain.generateRandomAddress();

        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister1, amountIn);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister2, amountIn);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister3, amountIn);

        console.log(``);
        console.log(`1st reservation`);
        const reserver1 = Blockchain.generateRandomAddress();
        await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver1,
            5000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        console.log(``);
        console.log(`2nd reservation`);
        const reserver2 = Blockchain.generateRandomAddress();
        const reserve2Result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver2,
            300000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber = 1003n;

        console.log(``);
        console.log(`swap 2nd reservation`);
        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            reserve2Result.response.events,
        );
        createRecipientUTXOs(decodedReservation.recipients);
        await helper_swap(nativeSwap, tokenAddress, reserver2, false);

        Blockchain.blockNumber = 1011n;

        console.log(``);
        console.log(`Relist lister1`);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister1, amountIn);
        /*
        let pd = await nativeSwap.getProviderDetails({ token: tokenAddress });
        logProviderDetailsResult(pd);

        Blockchain.blockNumber = 1012n;

        console.log(``);
        console.log(`4th reservation`);
        const reserver4 = Blockchain.generateRandomAddress();
        await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver4,
            30000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        pd = await nativeSwap.getProviderDetails({ token: tokenAddress });
        logProviderDetailsResult(pd);

        console.log(``);
        console.log(`list lister4`);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister4, amountIn);

        console.log(``);
        console.log(`5th reservation`);
        const reserver5 = Blockchain.generateRandomAddress();
        await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver5,
            3000000n,
            0n,
            false,
            false,
            false,
            2,
        );
        
 */
    });

    await vm.it('should produce the bug2', async () => {
        Blockchain.blockNumber = 1000n;
        const amountIn = Blockchain.expandTo18Decimals(500);

        const lister1 = Blockchain.generateRandomAddress();
        const lister2 = Blockchain.generateRandomAddress();
        const lister3 = Blockchain.generateRandomAddress();

        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister1, amountIn);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister2, amountIn);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister3, amountIn);

        console.log(``);
        console.log(`1st reservation`);
        const reserver1 = Blockchain.generateRandomAddress();
        const reserve1Result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver1,
            30000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber = 1003n;

        console.log(``);
        console.log(`swap 2nd reservation`);
        const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
            reserve1Result.response.events,
        );
        createRecipientUTXOs(decodedReservation.recipients);
        await helper_swap(nativeSwap, tokenAddress, reserver1, false);

        Blockchain.blockNumber = 1011n;

        console.log(``);
        console.log(`Relist lister1`);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister1, amountIn);

        Blockchain.blockNumber = 1013n;
        console.log(``);
        console.log(`2nd reservation`);
        const reserver2 = Blockchain.generateRandomAddress();
        const reserve2Result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver2,
            30000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        console.log(`3rd reservation`);
        const reserver3 = Blockchain.generateRandomAddress();
        const reserve3Result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver3,
            30000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber = 1023n;
        //console.log(``);
        //console.log(`Relist lister1`);
        //await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister1, amountIn);

        console.log(`4th reservation`);
        const reserver4 = Blockchain.generateRandomAddress();
        const reserve4Result = await helper_reserve(
            nativeSwap,
            tokenAddress,
            reserver4,
            30000000n,
            0n,
            false,
            false,
            false,
            2,
        );

        Blockchain.blockNumber = 1024n;
        console.log(``);
        console.log(`Relist lister1`);
        await listToken(nativeSwap, token, tokenAddress, contractOwnerAddress, lister1, amountIn);
    });
});
