import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { Address, BinaryWriter, EcKeyPair, MessageSigner, Wallet } from '@btc-vision/transaction';
import { helper_createToken } from '../../utils/OperationHelper.js';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { LiquidityListedEvent } from '../../../contracts/NativeSwapTypes.js';

await opnet('Native Swap - User flows - Create a new pool ', async (vm: OPNetUnit) => {
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

    await vm.it('should create a pool with no antibot settings and emit events', async () => {
        await token.approve(
            userAddress,
            nativeSwap.address,
            Blockchain.expandToDecimal(1000000, 18),
        );

        const createPoolResult = await nativeSwap.createPool({
            token: token.address,
            floorPrice: 10n ** 18n / 10000n,
            initialLiquidity: 1000000n * 10n ** 18n,
            receiver: btcReceiverAddress,
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 7500,
        });

        const evt: LiquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
            createPoolResult.response.events[1].data,
        );

        const settingsResult = await nativeSwap.getAntibotSettings({ token: token.address });

        Assert.expect(evt).toBeDefined();
        Assert.expect(evt.provider).toEqual(btcReceiverAddress);
        Assert.expect(evt.totalLiquidity).toEqual(1000000n * 10n ** 18n);
        Assert.expect(settingsResult.antiBotExpirationBlock).toEqual(0n);
        Assert.expect(settingsResult.maxTokensPerReservation).toEqual(0n);
    });

    await vm.it('should create a pool with antibot settings and emit events', async () => {
        await token.approve(
            userAddress,
            nativeSwap.address,
            Blockchain.expandToDecimal(1000000, 18),
        );

        const createPoolResult = await nativeSwap.createPool({
            token: token.address,
            floorPrice: 10n ** 18n / 10000n,
            initialLiquidity: 1000000n * 10n ** 18n,
            receiver: btcReceiverAddress,
            antiBotEnabledFor: 3,
            antiBotMaximumTokensPerReservation: 50000n,
            maxReservesIn5BlocksPercent: 7500,
        });

        const evt: LiquidityListedEvent = NativeSwapTypesCoders.decodeLiquidityListedEvent(
            createPoolResult.response.events[1].data,
        );

        const settingsResult = await nativeSwap.getAntibotSettings({ token: token.address });

        Assert.expect(evt).toBeDefined();
        Assert.expect(evt.provider).toEqual(btcReceiverAddress);
        Assert.expect(evt.totalLiquidity).toEqual(1000000n * 10n ** 18n);
        Assert.expect(settingsResult.antiBotExpirationBlock).toEqual(4n);
        Assert.expect(settingsResult.maxTokensPerReservation).toEqual(50000n);
    });

    await vm.it('should revert when insufficient allowance', async () => {
        await token.approve(
            userAddress,
            nativeSwap.address,
            Blockchain.expandToDecimal(100000, 18),
        );

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow('Insufficient allowance');
    });

    await vm.it('should revert when trying to create a pool when already exists', async () => {
        await token.approve(
            userAddress,
            nativeSwap.address,
            Blockchain.expandToDecimal(1000000, 18),
        );

        await nativeSwap.createPool({
            token: token.address,
            floorPrice: 10n ** 18n / 10000n,
            initialLiquidity: 1000000n * 10n ** 18n,
            receiver: btcReceiverAddress,
            antiBotEnabledFor: 3,
            antiBotMaximumTokensPerReservation: 50000n,
            maxReservesIn5BlocksPercent: 7500,
        });

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow('Base quote already set');
    });

    await vm.it('should revert when token address does not exist', async () => {
        const fakeTokenAddress: Address = Blockchain.generateRandomAddress();

        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: fakeTokenAddress,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
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
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow(`Only token owner can call createPool`);
    });

    await vm.it('should revert when receiver is an invalid bitcoin address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: 'invalid address',
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow(`Invalid address: base58 error`);
    });

    await vm.it('should revert when receiver is an empty bitcoin address', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: '',
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow(`Invalid address: base58 error`);
    });

    await vm.it('should revert when floor price is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 0n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow(`Floor price cannot be zero`);
    });

    await vm.it('should revert when initial liquidity is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 0n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 3,
                antiBotMaximumTokensPerReservation: 50000n,
                maxReservesIn5BlocksPercent: 7500,
            });
        }).toThrow(`Initial liquidity cannot be zero`);
    });

    await vm.it('should revert when antiBotMaximumTokensPerReservation settings is 0', async () => {
        await Assert.expect(async () => {
            await nativeSwap.createPool({
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 1,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Anti-bot max tokens per reservation cannot be zero`);
    });

    await vm.it('should revert when signature length is not 64 bytes', async () => {
        const signature: Uint8Array = Uint8Array.from([1, 2, 3, 4, 5]);

        await Assert.expect(async () => {
            await nativeSwap.createPoolWithSignature({
                signature,
                amount: 10n ** 18n / 10000n,
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 1,
                nonce: 0n,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Invalid signature length`);
    });

    await vm.it('should revert when owner is a dead address', async () => {
        Blockchain.txOrigin = Blockchain.DEAD_ADDRESS;
        Blockchain.msgSender = Blockchain.DEAD_ADDRESS;

        const signature: Uint8Array = new Uint8Array(64);

        for (let i = 0; i < 64; ++i) {
            signature[i] = i;
        }

        await Assert.expect(async () => {
            await nativeSwap.createPoolWithSignature({
                signature,
                amount: 10n ** 18n / 10000n,
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 1,
                nonce: 0n,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`Address can not be dead address`);
    });

    await vm.it('should revert when signature is invalid', async () => {
        const signature: Uint8Array = new Uint8Array(64);

        for (let i = 0; i < 64; ++i) {
            signature[i] = i;
        }

        await Assert.expect(async () => {
            await nativeSwap.createPoolWithSignature({
                signature,
                amount: 10n ** 18n / 10000n,
                token: token.address,
                floorPrice: 10n ** 18n / 10000n,
                initialLiquidity: 1000000n * 10n ** 18n,
                receiver: btcReceiverAddress,
                antiBotEnabledFor: 1,
                nonce: 0n,
                antiBotMaximumTokensPerReservation: 0n,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`ApproveFrom: Invalid signature`);
    });

    await vm.it('should create a pool and emit events', async () => {
        const wallet = new Wallet(
            EcKeyPair.generateWallet(Blockchain.network).privateKey,
            Blockchain.network,
        );

        Blockchain.txOrigin = wallet.address;
        Blockchain.msgSender = wallet.address;

        const writer = new BinaryWriter();
        writer.writeAddress(Blockchain.txOrigin);
        writer.writeAddress(nativeSwap.address);
        writer.writeU256(1000000n * 10n ** 18n);
        writer.writeU256(0n);

        const tempToken = await helper_createToken(wallet.address, 18, 10_000_000);

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            writer.getBuffer(),
            Blockchain.network,
        );

        const result = await nativeSwap.createPoolWithSignature({
            signature: signature.signature,
            amount: 1000000n * 10n ** 18n,
            token: tempToken.address,
            floorPrice: 10n ** 18n / 10000n,
            initialLiquidity: 1000000n * 10n ** 18n,
            receiver: btcReceiverAddress,
            nonce: 0n,
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 4000,
        });

        const approvedEvent = NativeSwapTypesCoders.getApprovedEvent(result.response.events);

        Assert.expect(approvedEvent).toBeDefined();
        Assert.expect(approvedEvent?.owner).toEqualAddress(wallet.address);
        Assert.expect(approvedEvent?.spender).toEqualAddress(nativeSwap.address);
        Assert.expect(approvedEvent?.value).toEqual(1000000n * 10n ** 18n);

        const liquidityListedevent = NativeSwapTypesCoders.getLiquidityListedEvent(
            result.response.events,
        );

        Assert.expect(liquidityListedevent).toBeDefined();
        Assert.expect(liquidityListedevent?.totalLiquidity).toEqual(1000000n * 10n ** 18n);
        Assert.expect(liquidityListedevent?.provider).toEqual(btcReceiverAddress);
    });
});
