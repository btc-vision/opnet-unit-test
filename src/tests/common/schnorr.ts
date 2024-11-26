import { Address, EcKeyPair, MessageSigner, Wallet } from '@btc-vision/transaction';
import { Assert, Blockchain, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { EWMA } from '../../contracts/ewma/EWMA.js';
import bitcoin from '@btc-vision/bitcoin';

await opnet('EWMA Contract - Signature Verification Tests', async (vm: OPNetUnit) => {
    let ewma: EWMA;

    const wallet = Wallet.fromWif(
        EcKeyPair.generateRandomKeyPair(Blockchain.network).toWIF(),
        Blockchain.network,
    );

    const userAddress: Address = wallet.address;
    const ewmaAddress: Address = Blockchain.generateRandomAddress();

    vm.beforeEach(async () => {
        Blockchain.msgSender = userAddress;
        Blockchain.txOrigin = userAddress;

        // Reset blockchain state
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Instantiate and register the EWMA contract
        ewma = new EWMA(userAddress, ewmaAddress, 350_000_000_000n);
        Blockchain.register(ewma);

        await ewma.init();
    });

    vm.afterEach(() => {
        ewma.dispose();
        Blockchain.dispose();
    });

    // 1. Valid Signature Verification
    await vm.it('should verify a valid Schnorr signature successfully', async () => {
        const message: string = 'Valid signature test message.';
        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        const verify = MessageSigner.verifySignature(wallet.address, message, signature.signature);
        Assert.expect(verify).toEqual(true);

        const isValid = await ewma.verifySignature(signature.signature, signature.message);
        Assert.expect(isValid).toEqual(true);
    });

    // 2. Invalid Signature Verification
    await vm.it('should fail verification for an invalid Schnorr signature', async () => {
        const message: string = 'Invalid signature test message.';

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        // Tamper with the signature by flipping a bit
        const tamperedSignature = Buffer.from(signature.signature);
        tamperedSignature[0] ^= 0x02; // Flip the first bit

        const verify = MessageSigner.verifySignature(wallet.address, message, tamperedSignature);
        Assert.expect(verify).toEqual(false);

        const isValid = await ewma.verifySignature(tamperedSignature, signature.message);
        Assert.expect(isValid).toEqual(false);
    });

    // 3. Tampered Message Verification
    await vm.it('should fail verification when the message is tampered after signing', async () => {
        const originalMessage: string = 'Original message for signing.';
        const tamperedMessage: string = 'Tampered message for signing.';

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            originalMessage,
            Blockchain.network,
        );

        const hash = bitcoin.crypto.sha256(Buffer.from(tamperedMessage));

        // Attempt to verify the signature against the tampered message
        const verify = MessageSigner.verifySignature(
            wallet.address,
            tamperedMessage,
            signature.signature,
        );
        Assert.expect(verify).toEqual(false);

        const isValid = await ewma.verifySignature(signature.signature, hash);
        Assert.expect(isValid).toEqual(false);
    });

    // 4. Wrong Public Key Verification
    await vm.it('should fail verification when using a wrong public key', async () => {
        const message: string = 'Message with wrong public key.';

        // Generate a different wallet
        const anotherWallet = Wallet.fromWif(
            EcKeyPair.generateRandomKeyPair(Blockchain.network).toWIF(),
            Blockchain.network,
        );

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        // Attempt to verify the signature using another wallet's address
        const verify = MessageSigner.verifySignature(
            anotherWallet.address,
            message,
            signature.signature,
        );
        Assert.expect(verify).toEqual(false);

        Blockchain.msgSender = new Address(anotherWallet.keypair.publicKey);
        Blockchain.txOrigin = new Address(anotherWallet.keypair.publicKey);

        const isValid = await ewma.verifySignature(signature.signature, signature.message);
        Assert.expect(isValid).toEqual(false);
    });

    // 5. Empty Message Verification
    await vm.it('should verify a signature for an empty message successfully', async () => {
        const message: string = '';

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        const verify = MessageSigner.verifySignature(wallet.address, message, signature.signature);
        Assert.expect(verify).toEqual(true);

        const isValid = await ewma.verifySignature(signature.signature, signature.message);
        Assert.expect(isValid).toEqual(true);
    });

    // 6. Maximum Length Message Verification
    await vm.it('should verify a signature for a maximum length message successfully', async () => {
        // Define maximum message length (adjust as per contract's specifications)
        const maxLength = 1024; // Example: 1024 characters
        const message: string = 'A'.repeat(maxLength);

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        const verify = MessageSigner.verifySignature(wallet.address, message, signature.signature);
        Assert.expect(verify).toEqual(true);

        const isValid = await ewma.verifySignature(signature.signature, signature.message);
        Assert.expect(isValid).toEqual(true);
    });

    // 7. Multiple Signatures Verification
    await vm.it('should verify multiple valid Schnorr signatures successfully', async () => {
        const messages: string[] = [
            'First message for multiple signatures.',
            'Second message for multiple signatures.',
            'Third message for multiple signatures.',
        ];

        for (const msg of messages) {
            const signature = MessageSigner.tweakAndSignMessage(
                wallet.keypair,
                msg,
                Blockchain.network,
            );

            const verify = MessageSigner.verifySignature(wallet.address, msg, signature.signature);
            Assert.expect(verify).toEqual(true);

            const isValid = await ewma.verifySignature(signature.signature, signature.message);
            Assert.expect(isValid).toEqual(true);
        }
    });

    // 8. Signature from Different Wallets
    await vm.it('should handle signatures from different wallets appropriately', async () => {
        const message: string = 'Message signed by different wallets.';

        // Generate another wallet
        const anotherWallet = Wallet.fromWif(
            EcKeyPair.generateRandomKeyPair(Blockchain.network).toWIF(),
            Blockchain.network,
        );

        // Sign the message with the original wallet
        const signatureOriginal = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        // Sign the message with another wallet
        const signatureAnother = MessageSigner.tweakAndSignMessage(
            anotherWallet.keypair,
            message,
            Blockchain.network,
        );

        // Verify original signature with original wallet's address
        const verifyOriginal = MessageSigner.verifySignature(
            wallet.address,
            message,
            signatureOriginal.signature,
        );
        Assert.expect(verifyOriginal).toEqual(true);

        const isValidOriginal = await ewma.verifySignature(
            signatureOriginal.signature,
            signatureOriginal.message,
        );
        Assert.expect(isValidOriginal).toEqual(true);

        // Attempt to verify another wallet's signature with original wallet's address
        const verifyAnother = MessageSigner.verifySignature(
            wallet.address,
            message,
            signatureAnother.signature,
        );
        Assert.expect(verifyAnother).toEqual(false);

        const isValidAnother = await ewma.verifySignature(
            signatureAnother.signature,
            signatureAnother.message,
        );
        Assert.expect(isValidAnother).toEqual(false);
    });

    // 9. Signature with Altered Signature Length
    await vm.it('should fail verification for signatures with altered length', async () => {
        const message: string = 'Message with altered signature length.';

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        // Remove last byte to alter the signature length
        const alteredSignature = signature.signature.slice(0, -1);

        const isValid = await ewma.verifySignature(alteredSignature, signature.message);
        Assert.expect(isValid).toEqual(false);
    });

    // 10. Signature Verification with Invalid Public Key Format
    await vm.it('should fail verification when public key format is invalid', async () => {
        const message: string = 'Message with invalid public key format.';

        const signature = MessageSigner.tweakAndSignMessage(
            wallet.keypair,
            message,
            Blockchain.network,
        );

        // Generate an invalid public key (incorrect length)
        const invalidPublicKey = Buffer.alloc(31, 0); // 31 bytes instead of 32

        // @ts-expect-error - Assigning invalid public key to msgSender and txOrigin
        Blockchain.msgSender = invalidPublicKey;

        // @ts-expect-error - Assigning invalid public key to msgSender and txOrigin
        Blockchain.txOrigin = invalidPublicKey;

        await Assert.expect(async () => {
            await ewma.verifySignature(signature.signature, signature.message);
        }).toThrow();
    });
});
