import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { CreatePoolResult, GetAntibotSettingsResult } from '../../contracts/NativeSwapTypes.js';
import { helper_createToken } from '../utils/OperationHelper.js';

await opnet('Native Swap - Create Pool', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();
    const liquidityAmount: bigint = Blockchain.expandToDecimal(1000, tokenDecimals);
    const floorPrice: bigint = 1000n;
    const initialLiquidity: bigint = 1000n;
    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const antiBotEnabledFor = 0;
    const antiBotMaximumTokensPerReservation = 0n;

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        token = await helper_createToken(userAddress, tokenDecimals, 10_000_000);

        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

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
        }).toThrow(`Contract not found at address`);
    });

    await vm.it('should revert when caller is not the token owner', async () => {
        const fakeCallerAddress: Address = Blockchain.generateRandomAddress();

        Blockchain.txOrigin = fakeCallerAddress;
        Blockchain.msgSender = fakeCallerAddress;

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Only token owner can call createPool`);
    });

    await vm.it('should revert when receiver is an invalid bitcoin address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice,
                initialLiquidity,
                receiver: 'invalid address',
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Invalid address: base58 error`);
    });

    await vm.it('should revert when receiver is an empty bitcoin address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice,
                initialLiquidity,
                receiver: '',
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Invalid address: base58 error`);
    });

    await vm.it('should revert when floor price is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 0n,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Floor price cannot be zero`);
    });

    await vm.it('should revert when initial liquidity is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice,
                initialLiquidity: 0n,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Initial liquidity cannot be zero`);
    });

    await vm.it('should revert when antiBotMaximumTokensPerReservation settings is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor: 1,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Anti-bot max tokens per reservation cannot be zero`);
    });

    await vm.it('should revert when insufficient allowance', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 1000n,
                initialLiquidity: 340282366920938463463374607431768211454n,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(/Insufficient allowance/);
    });

    await vm.it('antiBot settings are correctly set', async () => {
        const pool: CreatePoolResult = await nativeSwap.createPool({
            token: token.address,
            floorPrice,
            initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 10,
            antiBotMaximumTokensPerReservation: 10n,
            maxReservesIn5BlocksPercent: 4000,
        });

        const antibotSettings: GetAntibotSettingsResult = await nativeSwap.getAntibotSettings({
            token: token.address,
        });

        Assert.expect(antibotSettings.antiBotExpirationBlock).toEqual(Blockchain.blockNumber + 10n);
        Assert.expect(antibotSettings.maxTokensPerReservation).toEqual(10n);
    });

    await vm.it('should successfully set quote', async () => {
        const quote = await nativeSwap.createPool({
            token: token.address,
            floorPrice,
            initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        Assert.expect(quote.result).toEqual(true);
    });

    await vm.it('LiquidityListedEvent should be emitted', async () => {
        const receiver: string = initialLiquidityProvider.p2tr(Blockchain.network);

        const quote = await nativeSwap.createPool({
            token: token.address,
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
    });

    await vm.it('should not set quote if already set', async () => {
        const quote = await nativeSwap.createPool({
            token: token.address,
            floorPrice,
            initialLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Base quote already set`);
    });
});
