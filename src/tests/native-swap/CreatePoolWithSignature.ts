import { Address, BinaryWriter, EcKeyPair, MessageSigner, Wallet } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../contracts/ewma/NativeSwap.js';
import { NativeSwapTypesCoders } from '../../contracts/ewma/NativeSwapTypesCoders.js';

await opnet('Native Swap - Create Pool With Signature', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: OP_20;

    const tokenDecimals = 18;
    const userAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const ewmaAddress: Address = Blockchain.generateRandomAddress();
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
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
    });

    await vm.it('should revert when signature length is not 64 bytes', async () => {
        const signature: Uint8Array = Uint8Array.from([1, 2, 3, 4, 5]);

        await Assert.expect(async () => {
            await nativeSwap.createPoolWithSignature({
                signature,
                amount: initialLiquidity,
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
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
                amount: initialLiquidity,
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
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
                amount: initialLiquidity,
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver: initialLiquidityProvider.p2tr(Blockchain.network),
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`ApproveFrom: Invalid signature`);
    });

    await vm.it('should revert when caller is not the token owner', async () => {
        const wallet = new Wallet(
            EcKeyPair.generateWallet(Blockchain.network).privateKey,
            Blockchain.network,
        );

        Blockchain.txOrigin = wallet.address;
        Blockchain.msgSender = wallet.address;

        const writer = new BinaryWriter();
        writer.writeAddress(wallet.address);
        writer.writeAddress(nativeSwap.address);
        writer.writeU256(initialLiquidity);

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            writer.getBuffer(),
            Blockchain.network,
        );

        const receiver: string = initialLiquidityProvider.p2tr(Blockchain.network);

        await Assert.expect(async () => {
            await nativeSwap.createPoolWithSignature({
                signature: signature.signature,
                amount: initialLiquidity,
                token: tokenAddress,
                floorPrice,
                initialLiquidity,
                receiver,
                antiBotEnabledFor,
                antiBotMaximumTokensPerReservation,
                maxReservesIn5BlocksPercent: 4000,
            });
        }).toThrow(`NATIVE_SWAP: Only token owner can call createPool`);
    });

    await vm.it('should create the pool and emit events when all is good', async () => {
        const wallet = new Wallet(
            EcKeyPair.generateWallet(Blockchain.network).privateKey,
            Blockchain.network,
        );

        Blockchain.txOrigin = wallet.address;
        Blockchain.msgSender = wallet.address;

        const writer = new BinaryWriter();
        writer.writeAddress(Blockchain.txOrigin);
        writer.writeAddress(nativeSwap.address);
        writer.writeU256(initialLiquidity);

        const tempToken = new OP_20({
            file: 'MyToken',
            deployer: wallet.address,
            address: Blockchain.generateRandomAddress(),
            decimals: tokenDecimals,
        });

        Blockchain.register(tempToken);
        await tempToken.init();

        // Mint tokens to the user
        await tempToken.mint(wallet.address, 10_000_000);

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            writer.getBuffer(),
            Blockchain.network,
        );

        const receiver: string = initialLiquidityProvider.p2tr(Blockchain.network);

        const result = await nativeSwap.createPoolWithSignature({
            signature: signature.signature,
            amount: initialLiquidity,
            token: tempToken.address,
            floorPrice,
            initialLiquidity,
            receiver,
            antiBotEnabledFor,
            antiBotMaximumTokensPerReservation,
            maxReservesIn5BlocksPercent: 4000,
        });

        const approvedEvent = NativeSwapTypesCoders.getApprovedEvent(result.response.events);

        Assert.expect(approvedEvent).toBeDefined();
        Assert.expect(approvedEvent?.owner).toEqualAddress(wallet.address);
        Assert.expect(approvedEvent?.spender).toEqualAddress(nativeSwap.address);
        Assert.expect(approvedEvent?.value).toEqual(initialLiquidity);

        const liquidityListedevent = NativeSwapTypesCoders.getLiquidityListedEvent(
            result.response.events,
        );

        Assert.expect(liquidityListedevent).toBeDefined();
        Assert.expect(liquidityListedevent?.totalLiquidity).toEqual(initialLiquidity);
        Assert.expect(liquidityListedevent?.provider).toEqual(receiver);
    });
});
