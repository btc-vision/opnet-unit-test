import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';
import { gas2BTC, gas2Sat, gas2USD } from '../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/ewma/NativeSwapTypesCoders.js';
import {
    CreatePoolResult,
    GetAntibotSettingsResult,
} from '../../contracts/ewma/NativeSwapTypes.js';

await opnet('Native Swap - Create Pool', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const satoshisIn: bigint = 1_000_000_000_000n; //100_000n  BTC 1_000_000_000_000n

    const floorPrice: bigint = 1000n;
    const initialLiquidity: bigint = 1000n;
    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const antiBotEnabledFor = 0;
    const antiBotMaximumTokensPerReservation = 0n;

    vm.beforeEach(async () => {
        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the OP_20 token
        token = new OP_20({
            file: 'MyToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });

        Blockchain.register(token);
        await token.init();

        // Mint tokens to the user
        await token.mint(userAddress, 10_000_000);

        // Instantiate and register the nativeSwap contract
        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        // Add liquidity
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        await token.approve(userAddress, nativeSwap.address, liquidityAmount);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should revert when token address does not exist', async () => {
        const fakeTokenAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.tracePointers = false;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: fakeTokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`OPNET: RuntimeError: Error: Contract not found at address`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should revert when caller is not the token owner', async () => {
        const fakeCallerAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.tracePointers = false;
        Blockchain.txOrigin = fakeCallerAddress;
        Blockchain.msgSender = fakeCallerAddress;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`OPNET: Execution aborted: NATIVE_SWAP: Only token owner can call createPool`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should revert when receiver is an invalid bitcoin address', async () => {
        Blockchain.tracePointers = false;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: 'invalid address',
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Invalid receiver address`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should revert when receiver is an empty bitcoin address', async () => {
        Blockchain.tracePointers = false;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: '',
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Invalid receiver address`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should revert when floor price is 0', async () => {
        Blockchain.tracePointers = false;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice: 0n,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Floor price cannot be zero`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should revert when initial liquidity is 0', async () => {
        Blockchain.tracePointers = false;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice,
                initialLiquidity: 0n,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Initial liquidity cannot be zero`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should revert when antiBotMaximumTokensPerReservation settings is 0', async () => {
        Blockchain.tracePointers = false;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor: 1,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Anti-bot max tokens per reservation cannot be zero`);

        Blockchain.tracePointers = false;
    });

    await vm.it('antiBot settings are correctly set', async () => {
        Blockchain.tracePointers = false;

        const pool: CreatePoolResult = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice,
            initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 10,
            antiBotMaximumTokensPerReservation: 10n,
            maxReservesIn5BlocksPercent: 4000,
        });

        const antibotSettings: GetAntibotSettingsResult = await nativeSwap.getAntibotSettings({
            token: tokenAddress,
        });

        vm.debug(
            `antiBotExpirationBlock: ${antibotSettings.antiBotExpirationBlock}, Blockchain.blockNumber: ${Blockchain.blockNumber} maxTokensPerReservation:${antibotSettings.maxTokensPerReservation}`,
        );

        Assert.expect(antibotSettings.antiBotExpirationBlock).toEqual(Blockchain.blockNumber + 10n);
        Assert.expect(antibotSettings.maxTokensPerReservation).toEqual(10n);

        Blockchain.tracePointers = false;
    });

    await vm.it('should successfully set quote', async () => {
        Blockchain.tracePointers = false;

        const quote = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice,
            initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        vm.debug(
            `Quote set! Gas cost: ${gas2Sat(quote.response.usedGas)}sat (${gas2BTC(quote.response.usedGas)} BTC, $${gas2USD(quote.response.usedGas)})`,
        );

        Blockchain.tracePointers = false;
    });

    await vm.it('LiquidityListedEvent should be emitted', async () => {
        Blockchain.tracePointers = false;
        const receiver: string = initialLiquidityProvider.p2tr(Blockchain.network);

        const quote = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice,
            initialLiquidity,
            receiver,
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        const event = NativeSwapTypesCoders.getLiquidityListedEvent(quote.response.events);

        Assert.expect(event).toBeDefined();
        Assert.expect(event?.totalLiquidity).toEqual(initialLiquidity);
        Assert.expect(event?.provider).toEqual(receiver);

        vm.debug(`total liquidity is ${event?.totalLiquidity}, receiver is ${event?.provider}`);

        Blockchain.tracePointers = false;
    });

    await vm.it('should not set quote if already set', async () => {
        Blockchain.tracePointers = false;

        const quote = await nativeSwap.createPool({
            token: tokenAddress,
            floorPrice,
            initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Base quote already set`);

        vm.debug(
            `Quote set! Gas cost: ${gas2Sat(quote.response.usedGas)}sat (${gas2BTC(quote.response.usedGas)} BTC, $${gas2USD(quote.response.usedGas)})`,
        );

        Blockchain.tracePointers = false;
    });
});
