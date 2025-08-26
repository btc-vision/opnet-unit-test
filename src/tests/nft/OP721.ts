import { Address } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    OP721Extended,
    opnet,
    OPNetUnit,
    Transaction,
    TransactionInput,
    TransactionOutput,
} from '@btc-vision/unit-test-framework';

// Recipient type for creating UTXOs
interface Recipient {
    address: string;
    amount: bigint;
}

// Helper function to generate a transaction ID
function generateTransactionId(): Uint8Array {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}

// Helper function to generate empty transaction
function generateEmptyTransaction(): Transaction {
    const txId = generateTransactionId();
    const inputs: TransactionInput[] = [];
    const outputs: TransactionOutput[] = [];
    return new Transaction(txId, inputs, outputs);
}

// Helper function to create recipient UTXOs
function createRecipientUTXOs(recipients: Recipient[]): void {
    const tx: Transaction = generateEmptyTransaction();

    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        tx.addOutput(recipient.amount, recipient.address);
    }

    Blockchain.transaction = tx;
}

function createTreasuryOutput(treasuryAddress: string, amount: bigint): void {
    createRecipientUTXOs([{ address: treasuryAddress, amount }]);
}

// Helper function to clear transaction
function clearOutputs(): void {
    Blockchain.transaction = null;
}

await opnet('MyNFT - Reservation System Tests', async (vm: OPNetUnit) => {
    let nft: OP721Extended;

    const deployerAddress: Address = Blockchain.generateRandomAddress();
    const tokenAddress: Address = Blockchain.generateRandomAddress();
    const treasuryAddress: string = deployerAddress.p2tr(Blockchain.network);

    // Test users
    const alice: Address = Blockchain.generateRandomAddress();
    const bob: Address = Blockchain.generateRandomAddress();
    const charlie: Address = Blockchain.generateRandomAddress();

    // Constants from contract
    const MINT_PRICE = 100_000n; // 0.001 BTC per NFT
    const RESERVATION_FEE_PERCENT = 15n;
    const MINT_FEE = (MINT_PRICE * RESERVATION_FEE_PERCENT) / 100n; // 15,000 sats per NFT
    const RESERVATION_BLOCKS = 5n;
    const GRACE_BLOCKS = 1n;
    const MAX_BLOCKS_TO_PURGE = RESERVATION_BLOCKS + GRACE_BLOCKS;
    const MAX_RESERVATION_AMOUNT = 20;

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        // Set initial block number
        Blockchain.blockNumber = 1000n;

        nft = new OP721Extended({
            file: 'MyNFT',
            deployer: deployerAddress,
            address: tokenAddress,
        });

        Blockchain.register(nft);
        await nft.init();

        // Enable minting by default
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;
        await nft.setMintEnabled(true);

        // Reset to user context
        Blockchain.msgSender = alice;
        Blockchain.txOrigin = alice;
    });

    vm.afterEach(() => {
        clearOutputs();
        nft.dispose();
        Blockchain.dispose();
    });

    // ============= Basic Contract Tests =============

    await vm.it('should deploy with correct initial state', async () => {
        const name = await nft.name();
        const symbol = await nft.symbol();
        const maxSupply = await nft.maxSupply();
        const totalSupply = await nft.totalSupply();
        const mintEnabled = await nft.isMintEnabled();

        Assert.expect(name).toEqual('Cool NFT');
        Assert.expect(symbol).toEqual('O_o');
        Assert.expect(maxSupply).toEqual(10000n);
        Assert.expect(totalSupply).toEqual(0n);
        Assert.expect(mintEnabled).toEqual(true);
    });

    await vm.it('should get correct status information', async () => {
        const status = await nft.getStatus();

        Assert.expect(status.minted).toEqual(0n);
        Assert.expect(status.reserved).toEqual(0n);
        Assert.expect(status.available).toEqual(10000n);
        Assert.expect(status.maxSupply).toEqual(10000n);
        Assert.expect(status.pricePerToken).toEqual(100000n);
        Assert.expect(status.reservationFeePercent).toEqual(15n);
        Assert.expect(status.minReservationFee).toEqual(1000n);
    });

    // ============= Minting Control Tests =============

    await vm.it('should allow deployer to enable/disable minting', async () => {
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;

        // Disable minting
        await nft.setMintEnabled(false);
        let enabled = await nft.isMintEnabled();
        Assert.expect(enabled).toEqual(false);

        // Re-enable minting
        await nft.setMintEnabled(true);
        enabled = await nft.isMintEnabled();
        Assert.expect(enabled).toEqual(true);
    });

    await vm.it('should fail when non-deployer tries to enable/disable minting', async () => {
        await Assert.expect(async () => {
            Blockchain.msgSender = alice;
            Blockchain.txOrigin = alice;

            await nft.setMintEnabled(false);
        }).toThrow('Only deployer can call this');
    });

    await vm.it('should fail to reserve when minting is disabled', async () => {
        // Disable minting
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;
        await nft.setMintEnabled(false);

        // Try to reserve
        Blockchain.msgSender = alice;
        Blockchain.txOrigin = alice;

        const reservationFee = nft.calculateReservationFee(1n);
        createTreasuryOutput(treasuryAddress, reservationFee);

        await Assert.expect(async () => {
            await nft.reserve(1n, alice);
        }).toThrow('Minting is disabled');
    });

    // ============= Basic Reservation Tests =============

    await vm.it('should create a reservation with correct fee calculation', async () => {
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);

        Assert.expect(reservationFee).toEqual(MINT_FEE); // Min fee applies for 1 NFT

        createTreasuryOutput(treasuryAddress, reservationFee);

        const result = await nft.reserve(quantity, alice);

        Assert.expect(result.remainingPayment).toEqual(MINT_PRICE - MINT_FEE); // 100k - 1k min fee
        Assert.expect(result.reservationBlock).toEqual(1000n);
    });

    await vm.it('should create reservation for multiple NFTs with percentage fee', async () => {
        const quantity = 10n;
        const totalCost = MINT_PRICE * quantity; // 1,000,000 sats
        const expectedFee = (totalCost * RESERVATION_FEE_PERCENT) / 100n; // 150,000 sats
        const reservationFee = nft.calculateReservationFee(quantity);

        Assert.expect(reservationFee).toEqual(expectedFee);

        createTreasuryOutput(treasuryAddress, reservationFee);

        const result = await nft.reserve(quantity, alice);

        Assert.expect(result.remainingPayment).toEqual(850000n); // 1M - 150k
        Assert.expect(result.reservationBlock).toEqual(1000n);
    });

    await vm.it('should fail to reserve with invalid quantity', async () => {
        // Test zero quantity
        await Assert.expect(async () => {
            await nft.reserve(0n, alice);
        }).toThrow('Invalid quantity: must be between 1 and 20');

        // Test over max quantity
        await Assert.expect(async () => {
            await nft.reserve(21n, alice);
        }).toThrow('Invalid quantity: must be between 1 and 20');
    });

    await vm.it('should fail to reserve with insufficient payment', async () => {
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);

        // Pay less than required
        createTreasuryOutput(treasuryAddress, reservationFee - 1n);

        await Assert.expect(async () => {
            await nft.reserve(quantity, alice);
        }).toThrow('Insufficient reservation fee');
    });

    await vm.it('should fail when user has active reservation', async () => {
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);

        // First reservation
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);

        clearOutputs();

        // Try second reservation
        createTreasuryOutput(treasuryAddress, reservationFee);

        await Assert.expect(async () => {
            await nft.reserve(quantity, alice);
        }).toThrow('Active reservation exists');
    });

    // ============= Claim Tests =============

    await vm.it('should successfully claim reserved NFTs', async () => {
        const quantity = 3n;
        const reservationFee = nft.calculateReservationFee(quantity);

        // Create reservation
        createTreasuryOutput(treasuryAddress, reservationFee);
        const reservation = await nft.reserve(quantity, alice);

        clearOutputs();

        // Move forward 1 block (within claim period)
        Blockchain.blockNumber = 1001n;

        // Pay remaining amount to claim
        createTreasuryOutput(treasuryAddress, reservation.remainingPayment);

        const claimResult = await nft.claim(alice);

        Assert.expect(claimResult.startTokenId).toEqual(1n);
        Assert.expect(claimResult.amountClaimed).toEqual(quantity);

        // Verify NFTs were minted
        const balance = await nft.balanceOf(alice);
        Assert.expect(balance).toEqual(quantity);

        // Verify ownership of specific tokens
        for (let i = 1n; i <= quantity; i++) {
            const owner = await nft.ownerOf(i);
            Assert.expect(owner).toEqualAddress(alice);
        }
    });

    await vm.it('should claim within grace period', async () => {
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);

        // Create reservation
        createTreasuryOutput(treasuryAddress, reservationFee);
        const reservation = await nft.reserve(quantity, alice);

        clearOutputs();

        // Move to last block of grace period (block 1006)
        Blockchain.blockNumber = 1006n;

        // Should still be able to claim
        createTreasuryOutput(treasuryAddress, reservation.remainingPayment);
        const claimResult = await nft.claim(alice);

        Assert.expect(claimResult.amountClaimed).toEqual(quantity);
    });

    await vm.it('should fail to claim with no reservation', async () => {
        createTreasuryOutput(treasuryAddress, 100000n);

        await Assert.expect(async () => {
            await nft.claim(alice);
        }).toThrow('No reservation found');
    });

    await vm.it('should fail to claim after expiry', async () => {
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);

        // Create reservation
        createTreasuryOutput(treasuryAddress, reservationFee);
        const reservation = await nft.reserve(quantity, alice);

        clearOutputs();

        // Move past grace period (block 1007)
        Blockchain.blockNumber = 1007n;

        createTreasuryOutput(treasuryAddress, reservation.remainingPayment);

        await Assert.expect(async () => {
            await nft.claim(alice);
        }).toThrow('Reservation expired');
    });

    await vm.it('should fail to claim with insufficient payment', async () => {
        const quantity = 2n;
        const reservationFee = nft.calculateReservationFee(quantity);

        // Create reservation
        createTreasuryOutput(treasuryAddress, reservationFee);
        const reservation = await nft.reserve(quantity, alice);

        clearOutputs();

        // Move forward 1 block
        Blockchain.blockNumber = 1001n;

        // Pay less than required
        createTreasuryOutput(treasuryAddress, reservation.remainingPayment - 1n);

        await Assert.expect(async () => {
            await nft.claim(alice);
        }).toThrow('Insufficient payment - funds lost');
    });

    // ============= Purge Tests =============

    await vm.it('should auto-purge expired reservations on new reservation', async () => {
        // Alice makes reservation
        const quantity = 5n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);

        clearOutputs();

        // Check status shows reserved
        let status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(quantity);
        Assert.expect(status.available).toEqual(10000n - quantity);

        // Move past expiry
        Blockchain.blockNumber = 1007n;

        // Bob makes new reservation (should trigger purge)
        Blockchain.msgSender = bob;
        Blockchain.txOrigin = bob;
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(2n, bob);

        clearOutputs();

        // Check Alice's reservation was purged
        status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(2n); // Only Bob's reservation
        Assert.expect(status.available).toEqual(10000n - 2n);
    });

    await vm.it('should manually purge expired reservations', async () => {
        // Create multiple reservations
        const users = [alice, bob, charlie];

        for (let i = 0; i < users.length; i++) {
            Blockchain.msgSender = users[i];
            Blockchain.txOrigin = users[i];

            const reservationFee = nft.calculateReservationFee(3n);
            createTreasuryOutput(treasuryAddress, reservationFee);
            await nft.reserve(3n, users[i]);

            clearOutputs();
            Blockchain.blockNumber += 1n;
        }

        // Check total reserved
        let status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(9n);

        // Move past expiry for all
        Blockchain.blockNumber = 1010n;

        // Manually purge
        const purgeResult = await nft.purgeExpired();

        Assert.expect(purgeResult.totalPurged).toEqual(9n);
        Assert.expect(purgeResult.blocksProcessed).toBeGreaterThan(0);

        // Verify all reservations cleared
        status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(0n);
        Assert.expect(status.available).toEqual(10000n);
    });

    // ============= Supply Management Tests =============

    await vm.it('should prevent reservations exceeding available supply', async () => {
        // Try to reserve entire supply + 1
        const quantity = 10001n;
        const reservationFee = nft.calculateReservationFee(quantity);

        createTreasuryOutput(treasuryAddress, reservationFee);

        await Assert.expect(async () => {
            await nft.reserve(quantity, alice);
        }).toThrow(); // Should fail due to insufficient supply
    });

    await vm.it('should correctly track supply across mints and reservations', async () => {
        // Alice reserves 5
        let reservationFee = nft.calculateReservationFee(5n);
        createTreasuryOutput(treasuryAddress, reservationFee);
        let reservation = await nft.reserve(5n, alice);
        clearOutputs();

        // Bob reserves 3
        Blockchain.msgSender = bob;
        Blockchain.txOrigin = bob;
        reservationFee = nft.calculateReservationFee(3n);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(3n, bob);
        clearOutputs();

        // Check status
        let status = await nft.getStatus();
        Assert.expect(status.minted).toEqual(0n);
        Assert.expect(status.reserved).toEqual(8n);
        Assert.expect(status.available).toEqual(9992n);

        // Alice claims
        Blockchain.msgSender = alice;
        Blockchain.txOrigin = alice;
        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, reservation.remainingPayment);
        await nft.claim(alice);
        clearOutputs();

        // Check updated status
        status = await nft.getStatus();
        Assert.expect(status.minted).toEqual(5n);
        Assert.expect(status.reserved).toEqual(3n);
        Assert.expect(status.available).toEqual(9992n);
    });

    // ============= Edge Cases and Complex Scenarios =============

    await vm.it('should handle overwriting expired reservation for same user', async () => {
        // First reservation
        const reservationFee = nft.calculateReservationFee(2n);
        vm.log(`Reservation fee for 2 NFTs: ${reservationFee}`);

        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(2n, alice);
        clearOutputs();

        // Let it expire
        Blockchain.blockNumber = 1007n;

        const reservationFee2 = nft.calculateReservationFee(3n);
        vm.log(`Reservation fee for 3 NFTs: ${reservationFee2}`);

        // New reservation should overwrite the expired one
        createTreasuryOutput(treasuryAddress, reservationFee2);

        const newReservation = await nft.reserve(3n, alice);

        Assert.expect(newReservation.reservationBlock).toEqual(1007n);

        // Should be able to claim the new reservation
        clearOutputs();
        Blockchain.blockNumber = 1008n;
        const remainingPayment = nft.calculateRemainingPayment(3n);
        createTreasuryOutput(treasuryAddress, remainingPayment);
        const claim = await nft.claim(alice);

        Assert.expect(claim.amountClaimed).toEqual(3n);
    });

    await vm.it('should handle maximum reservations per block correctly', async () => {
        // Create max reservations in different blocks to avoid purge conflicts
        const users: Address[] = [];
        for (let i = 0; i < 10; i++) {
            users.push(Blockchain.generateRandomAddress());
        }

        // Make reservations
        for (let i = 0; i < users.length; i++) {
            Blockchain.msgSender = users[i];
            Blockchain.txOrigin = users[i];

            const reservationFee = nft.calculateReservationFee(1n);
            createTreasuryOutput(treasuryAddress, reservationFee);
            await nft.reserve(1n, users[i]);
            clearOutputs();
        }

        const status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(BigInt(users.length));
        Assert.expect(status.blocksWithReservations).toEqual(1);
    });

    await vm.it('should correctly calculate fees for edge case quantities', () => {
        // Test for 1 NFT - 15% fee applies, not minimum
        const fee1NFT = nft.calculateReservationFee(1n);
        Assert.expect(fee1NFT).toEqual(15000n); // 15% of 100k = 15k, not MIN_RESERVATION_FEE

        // Test for 6 NFTs
        const smallQuantity = 6n;
        const feeSmall = nft.calculateReservationFee(smallQuantity);
        const expectedSmall = (600000n * 15n) / 100n; // 90000 sats
        Assert.expect(feeSmall).toEqual(expectedSmall); // 90k is correct

        // Test large quantity remains correct
        const largeQuantity = 20n;
        const feeLarge = nft.calculateReservationFee(largeQuantity);
        const expectedLarge = (2000000n * 15n) / 100n; // 300k sats
        Assert.expect(feeLarge).toEqual(expectedLarge);
    });

    await vm.it('should track block reservation history correctly', async () => {
        // Make reservations across multiple blocks
        const reservation1Fee = nft.calculateReservationFee(2n);
        createTreasuryOutput(treasuryAddress, reservation1Fee);
        await nft.reserve(2n, alice);
        clearOutputs();

        Blockchain.blockNumber = 1005n;
        Blockchain.msgSender = bob;
        Blockchain.txOrigin = bob;
        const reservation2Fee = nft.calculateReservationFee(3n);
        createTreasuryOutput(treasuryAddress, reservation2Fee);
        await nft.reserve(3n, bob);
        clearOutputs();

        // Check status
        let status = await nft.getStatus();
        Assert.expect(status.blocksWithReservations).toEqual(2);

        // Move past first reservation expiry but not second
        Blockchain.blockNumber = 1007n;

        // Trigger purge with new reservation
        Blockchain.msgSender = charlie;
        Blockchain.txOrigin = charlie;
        createTreasuryOutput(treasuryAddress, reservation1Fee);
        await nft.reserve(1n, charlie);
        clearOutputs();

        // First reservation should be purged, others remain
        status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(4n); // Bob's 3 + Charlie's 1
    });

    // ============= Helper Function Tests =============

    await vm.it('should correctly check reservation expiry', () => {
        const reservationBlock = 1000n;
        const currentBlock1 = 1005n; // Not expired
        const currentBlock2 = 1006n; // Grace period
        const currentBlock3 = 1007n; // Expired

        Assert.expect(nft.isReservationExpired(reservationBlock, currentBlock1)).toEqual(false);
        Assert.expect(nft.isReservationExpired(reservationBlock, currentBlock2)).toEqual(false);
        Assert.expect(nft.isReservationExpired(reservationBlock, currentBlock3)).toEqual(true);
    });

    await vm.it('should correctly calculate blocks until expiry', () => {
        const reservationBlock = 1000n;

        Assert.expect(nft.getBlocksUntilExpiry(reservationBlock, 1000n)).toEqual(6n);
        Assert.expect(nft.getBlocksUntilExpiry(reservationBlock, 1003n)).toEqual(3n);
        Assert.expect(nft.getBlocksUntilExpiry(reservationBlock, 1006n)).toEqual(0n);
        Assert.expect(nft.getBlocksUntilExpiry(reservationBlock, 1007n)).toEqual(0n);
    });

    await vm.it('should format BTC correctly', () => {
        Assert.expect(OP721Extended.formatBTC(100000000n)).toEqual('1.00000000 BTC');
        Assert.expect(OP721Extended.formatBTC(100000n)).toEqual('0.00100000 BTC');
        Assert.expect(OP721Extended.formatBTC(1000n)).toEqual('0.00001000 BTC');
        Assert.expect(OP721Extended.formatBTC(1n)).toEqual('0.00000001 BTC');
    });

    // ============= Integration Tests =============

    await vm.it('should handle complete reservation lifecycle', async () => {
        // Alice reserves
        const aliceQuantity = 3n;
        const aliceFee = nft.calculateReservationFee(aliceQuantity);
        createTreasuryOutput(treasuryAddress, aliceFee);
        const aliceReservation = await nft.reserve(aliceQuantity, alice);
        clearOutputs();

        // Bob reserves
        Blockchain.msgSender = bob;
        Blockchain.txOrigin = bob;
        Blockchain.blockNumber = 1001n;
        const bobQuantity = 2n;
        const bobFee = nft.calculateReservationFee(bobQuantity);
        createTreasuryOutput(treasuryAddress, bobFee);
        await nft.reserve(bobQuantity, bob);
        clearOutputs();

        // Alice claims
        Blockchain.msgSender = alice;
        Blockchain.txOrigin = alice;
        Blockchain.blockNumber = 1002n;
        createTreasuryOutput(treasuryAddress, aliceReservation.remainingPayment);
        const aliceClaim = await nft.claim(alice);
        clearOutputs();

        Assert.expect(aliceClaim.startTokenId).toEqual(1n);
        Assert.expect(aliceClaim.amountClaimed).toEqual(aliceQuantity);

        // Bob's reservation expires
        Blockchain.blockNumber = 1008n;

        // Charlie reserves (triggers purge of Bob's reservation)
        Blockchain.msgSender = charlie;
        Blockchain.txOrigin = charlie;
        const charlieFee = nft.calculateReservationFee(5n);
        createTreasuryOutput(treasuryAddress, charlieFee);
        await nft.reserve(5n, charlie);
        clearOutputs();

        // Final status check
        const finalStatus = await nft.getStatus();
        Assert.expect(finalStatus.minted).toEqual(3n); // Alice's NFTs
        Assert.expect(finalStatus.reserved).toEqual(5n); // Charlie's reservation
        Assert.expect(finalStatus.available).toEqual(9992n);

        // Verify Alice owns her NFTs
        const aliceBalance = await nft.balanceOf(alice);
        Assert.expect(aliceBalance).toEqual(aliceQuantity);

        // Verify token ownership
        for (let i = 1n; i <= aliceQuantity; i++) {
            const owner = await nft.ownerOf(i);
            Assert.expect(owner).toEqualAddress(alice);
        }
    });

    await vm.it('should get complete reservation info', async () => {
        const info = await nft.getReservationInfo();

        // Check constants
        Assert.expect(info.constants.mintPrice).toEqual('0.00100000 BTC');
        Assert.expect(info.constants.reservationFeePercent).toEqual('15%');
        Assert.expect(info.constants.minReservationFee).toEqual('0.00001000 BTC');
        Assert.expect(info.constants.reservationBlocks).toEqual(5);
        Assert.expect(info.constants.graceBlocks).toEqual(1);
        Assert.expect(info.constants.maxReservationAmount).toEqual(20);
        Assert.expect(info.constants.totalExpiryBlocks).toEqual(6);

        // Check status
        Assert.expect(info.status.minted).toEqual(0n);
        Assert.expect(info.status.reserved).toEqual(0n);
        Assert.expect(info.status.available).toEqual(10000n);
    });

    // TOKEN URI TESTS

    await vm.it('should return correct tokenURI with baseURI', async () => {
        // Mint a token first
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Get token URI (should be baseURI + tokenId)
        const uri = await nft.tokenURI(1n);
        Assert.expect(uri).toEqual('1'); // Empty baseURI + tokenId "1"
    });

    await vm.it('should fail to get URI for non-existent token', async () => {
        await Assert.expect(async () => {
            await nft.tokenURI(999n);
        }).toThrow('Token does not exist');
    });

    await vm.it('should update baseURI correctly', async () => {
        // Only deployer can set baseURI
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;

        await nft.setBaseURI('https://example.com/metadata/');

        // Mint a token as alice
        Blockchain.msgSender = alice;
        Blockchain.txOrigin = alice;
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        const uri = await nft.tokenURI(1n);
        Assert.expect(uri).toEqual('https://example.com/metadata/1');
    });

    await vm.it('should fail when non-deployer tries to set baseURI', async () => {
        await Assert.expect(async () => {
            await nft.setBaseURI('https://example.com/');
        }).toThrow('Only deployer can call this');
    });

    // ============= Transfer Tests =============

    await vm.it('should transfer token between users', async () => {
        // Mint tokens to alice first
        const quantity = 2n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Transfer token 1 from alice to bob
        await nft.transferFrom(alice, bob, 1n, alice);

        // Check ownership and balances
        const owner = await nft.ownerOf(1n);
        Assert.expect(owner).toEqualAddress(bob);

        const aliceBalance = await nft.balanceOf(alice);
        Assert.expect(aliceBalance).toEqual(1n);

        const bobBalance = await nft.balanceOf(bob);
        Assert.expect(bobBalance).toEqual(1n);
    });

    await vm.it('should fail to transfer non-existent token', async () => {
        await Assert.expect(async () => {
            await nft.transferFrom(alice, bob, 999n, alice);
        }).toThrow('Token does not exist');
    });

    await vm.it('should fail to transfer from wrong owner', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Try to transfer from bob (who doesn't own it)
        await Assert.expect(async () => {
            await nft.transferFrom(bob, charlie, 1n, bob);
        }).toThrow('Transfer from incorrect owner');
    });

    /*await vm.it('should set and retrieve custom token URI', async () => {
        // Mint token first
        const quantity = 2n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Set custom URI for token 1
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;
        await nft.setTokenURI(1n, 'ipfs://QmCustomHash1');

        // Set custom URI for token 2
        await nft.setTokenURI(2n, 'ipfs://QmCustomHash2');

        // Verify custom URIs
        const uri1 = await nft.tokenURI(1n);
        Assert.expect(uri1).toEqual('ipfs://QmCustomHash1');

        const uri2 = await nft.tokenURI(2n);
        Assert.expect(uri2).toEqual('ipfs://QmCustomHash2');
    });

    await vm.it('should fail to set token URI for non-existent token', async () => {
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;

        await Assert.expect(async () => {
            await nft.setTokenURI(999n, 'ipfs://invalid');
        }).toThrow('Token does not exist');
    });

    await vm.it('should override custom URI when baseURI changes', async () => {
        // Mint token
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Set custom URI
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;
        await nft.setTokenURI(1n, 'ipfs://QmCustom');

        // Verify custom URI is used
        let uri = await nft.tokenURI(1n);
        Assert.expect(uri).toEqual('ipfs://QmCustom');

        // Update base URI
        await nft.setBaseURI('https://newbase.com/');

        // Custom URI should still be used (not overridden by base)
        uri = await nft.tokenURI(1n);
        Assert.expect(uri).toEqual('ipfs://QmCustom');
    });*/

    // ============= Contract Interaction Tests =============

    await vm.it('should handle onOP721Received callback', async () => {
        // This tests the MyNFT contract's implementation of onOP721Received
        // which allows it to receive NFTs
        const selector = await nft.onOP721Received(
            alice, // operator
            bob, // from
            1n, // tokenId
            new Uint8Array([1, 2, 3]), // data
            alice, // msgSender
        );

        // Should return the correct selector
        Assert.expect(selector).toEqual(0xd83e7dbc);
    });

    // ============= Approval Edge Cases =============

    await vm.it('should fail to approve to zero address', async () => {
        // Mint token first
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        const zeroAddress = new Address();
        await Assert.expect(async () => {
            await nft.approve(zeroAddress, 1n, alice);
        }).toThrow('Cannot approve to zero address');
    });

    await vm.it('should fail to approve to current owner', async () => {
        // Mint token
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Try to approve to self (alice is owner)
        await Assert.expect(async () => {
            await nft.approve(alice, 1n, alice);
        }).toThrow('Approval to current owner');
    });

    await vm.it('should fail to set approval for all to self', async () => {
        await Assert.expect(async () => {
            await nft.setApprovalForAll(alice, true, alice);
        }).toThrow('Cannot approve self');
    });

    await vm.it('should fail to get approved for non-existent token', async () => {
        await Assert.expect(async () => {
            await nft.getApproved(999n);
        }).toThrow('Token does not exist');
    });

    // ============= Concurrent Reservations Tests =============

    await vm.it('should handle multiple users reserving in same block', async () => {
        // Multiple users make reservations in the same block
        const users = [alice, bob, charlie];
        const quantities = [2n, 3n, 1n];

        for (let i = 0; i < users.length; i++) {
            Blockchain.msgSender = users[i];
            Blockchain.txOrigin = users[i];

            const fee = nft.calculateReservationFee(quantities[i]);
            createTreasuryOutput(treasuryAddress, fee);
            await nft.reserve(quantities[i], users[i]);
            clearOutputs();
        }

        // Check all reservations are tracked
        const status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(6n); // 2 + 3 + 1
        Assert.expect(status.blocksWithReservations).toEqual(1); // All in same block

        // Move to claim period
        Blockchain.blockNumber = 1001n;

        // All should be able to claim
        for (let i = 0; i < users.length; i++) {
            Blockchain.msgSender = users[i];
            Blockchain.txOrigin = users[i];

            const remaining = nft.calculateRemainingPayment(quantities[i]);
            createTreasuryOutput(treasuryAddress, remaining);

            const claim = await nft.claim(users[i]);
            Assert.expect(claim.amountClaimed).toEqual(quantities[i]);
            clearOutputs();
        }

        // Verify final state
        const finalStatus = await nft.getStatus();
        Assert.expect(finalStatus.minted).toEqual(6n);
        Assert.expect(finalStatus.reserved).toEqual(0n);
    });

    // ============= Purge Limit Tests =============

    await vm.it('should respect MAX_BLOCKS_TO_PURGE limit', async () => {
        // Create reservations across many blocks (more than MAX_BLOCKS_TO_PURGE)
        const blockCount = 15; // More than MAX_BLOCKS_TO_PURGE (10)

        for (let i = 0; i < blockCount; i++) {
            const user = Blockchain.generateRandomAddress();
            Blockchain.msgSender = user;
            Blockchain.txOrigin = user;
            Blockchain.blockNumber = 1000n + BigInt(i);

            const fee = nft.calculateReservationFee(1n);
            createTreasuryOutput(treasuryAddress, fee);
            await nft.reserve(1n, user);
            clearOutputs();
        }

        // Check initial state
        let status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(MAX_BLOCKS_TO_PURGE);
        Assert.expect(status.blocksWithReservations).toEqual(Number(MAX_BLOCKS_TO_PURGE));

        // Move way past expiry for all
        Blockchain.blockNumber = 1030n;

        // Manual purge should only process MAX_BLOCKS_TO_PURGE
        const purgeResult = await nft.purgeExpired();
        Assert.expect(purgeResult.blocksProcessed).toEqual(Number(MAX_BLOCKS_TO_PURGE)); // MAX_BLOCKS_TO_PURGE
        Assert.expect(purgeResult.totalPurged).toEqual(MAX_BLOCKS_TO_PURGE);

        // Should still have 5 expired reservations left
        status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(0n);

        // Second purge should clear the rest
        const purgeResult2 = await nft.purgeExpired();
        Assert.expect(purgeResult2.blocksProcessed).toEqual(0);
        Assert.expect(purgeResult2.totalPurged).toEqual(0n);

        // All should be cleared now
        status = await nft.getStatus();
        Assert.expect(status.reserved).toEqual(0n);
    });

    // ============= Balance Edge Cases =============

    await vm.it('should fail to get balance of zero address', async () => {
        const zeroAddress = new Address();
        await Assert.expect(async () => {
            await nft.balanceOf(zeroAddress);
        }).toThrow('Invalid address');
    });

    // ============= Enumeration Edge Cases =============

    await vm.it('should handle enumeration after burning', async () => {
        // Mint 3 tokens
        const quantity = 3n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Burn middle token
        await nft.burn(2n, alice);

        // Check enumeration - should have tokens 1 and 3
        const token0 = await nft.tokenOfOwnerByIndex(alice, 0n);
        const token1 = await nft.tokenOfOwnerByIndex(alice, 1n);
        Assert.expect(token0).toEqual(1n);
        Assert.expect(token1).toEqual(3n);

        const balance = await nft.balanceOf(alice);
        Assert.expect(balance).toEqual(2n);
    });

    // ============= Transfer Authorization Tests =============

    await vm.it('should fail transfer when not owner or approved', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Charlie (not approved) tries to transfer alice's token
        await Assert.expect(async () => {
            await nft.transferFrom(alice, bob, 1n, charlie);
        }).toThrow('Not authorized to transfer');
    });

    // ============= Empty Base URI Tests =============

    await vm.it('should fail to set empty base URI', async () => {
        Blockchain.msgSender = deployerAddress;
        Blockchain.txOrigin = deployerAddress;

        await Assert.expect(async () => {
            await nft.setBaseURI('');
        }).toThrow('Base URI cannot be empty');
    });

    // ============= Domain Separator Test =============

    await vm.it('should get domain separator', async () => {
        const domainSeparator = await nft.domainSeparator();

        // Should be a 32-byte value
        Assert.expect(domainSeparator.length).toEqual(32);

        // Should be non-zero
        let isNonZero = false;
        for (let i = 0; i < domainSeparator.length; i++) {
            if (domainSeparator[i] !== 0) {
                isNonZero = true;
                break;
            }
        }
        Assert.expect(isNonZero).toEqual(true);
    });

    await vm.it('should fail to transfer to zero address', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        const zeroAddress = new Address();
        await Assert.expect(async () => {
            await nft.transferFrom(alice, zeroAddress, 1n, alice);
        }).toThrow('Transfer to zero address');
    });

    // ============= Approval Tests =============

    await vm.it('should approve and transfer via approved address', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Alice approves bob for token 1
        await nft.approve(bob, 1n, alice);

        // Check approval
        const approved = await nft.getApproved(1n);
        Assert.expect(approved).toEqualAddress(bob);

        // Bob transfers the token to charlie
        await nft.transferFrom(alice, charlie, 1n, bob);

        // Check new owner
        const owner = await nft.ownerOf(1n);
        Assert.expect(owner).toEqualAddress(charlie);

        // Approval should be cleared after transfer
        const approvedAfter = await nft.getApproved(1n);
        const zeroAddress = new Address();
        Assert.expect(approvedAfter).toEqualAddress(zeroAddress);
    });

    await vm.it('should set approval for all', async () => {
        // Mint tokens to alice
        const quantity = 3n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Alice approves bob for all tokens
        await nft.setApprovalForAll(bob, true, alice);

        // Check approval
        const isApproved = await nft.isApprovedForAll(alice, bob);
        Assert.expect(isApproved).toEqual(true);

        // Bob can transfer any of alice's tokens
        await nft.transferFrom(alice, charlie, 2n, bob);

        const owner = await nft.ownerOf(2n);
        Assert.expect(owner).toEqualAddress(charlie);
    });

    await vm.it('should revoke approval for all', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Approve and then revoke
        await nft.setApprovalForAll(bob, true, alice);
        await nft.setApprovalForAll(bob, false, alice);

        const isApproved = await nft.isApprovedForAll(alice, bob);
        Assert.expect(isApproved).toEqual(false);

        // Bob should not be able to transfer
        await Assert.expect(async () => {
            await nft.transferFrom(alice, charlie, 1n, bob);
        }).toThrow('Not authorized to transfer');
    });

    // ============= Burn Tests =============

    await vm.it('should burn token by owner', async () => {
        // Mint tokens to alice
        const quantity = 2n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Burn token 1
        await nft.burn(1n, alice);

        // Check token no longer exists
        await Assert.expect(async () => {
            await nft.ownerOf(1n);
        }).toThrow('Token does not exist');

        // Check balance and total supply
        const balance = await nft.balanceOf(alice);
        Assert.expect(balance).toEqual(1n);

        const totalSupply = await nft.totalSupply();
        Assert.expect(totalSupply).toEqual(1n);
    });

    await vm.it('should burn token via approved address', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Alice approves bob
        await nft.approve(bob, 1n, alice);

        // Bob burns the token
        await nft.burn(1n, bob);

        // Check token no longer exists
        await Assert.expect(async () => {
            await nft.ownerOf(1n);
        }).toThrow('Token does not exist');
    });

    await vm.it('should fail to burn non-existent token', async () => {
        await Assert.expect(async () => {
            await nft.burn(999n, alice);
        }).toThrow('Token does not exist');
    });

    await vm.it('should fail to burn without authorization', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Bob tries to burn alice's token without approval
        await Assert.expect(async () => {
            await nft.burn(1n, bob);
        }).toThrow('Not authorized to burn');
    });

    // ============= Enumerable Tests =============

    await vm.it('should enumerate tokens of owner', async () => {
        // Mint multiple tokens to alice
        const quantity = 5n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Check each token by index
        for (let i = 0n; i < quantity; i++) {
            const tokenId = await nft.tokenOfOwnerByIndex(alice, i);
            Assert.expect(tokenId).toEqual(i + 1n);
        }
    });

    await vm.it('should update enumeration after transfer', async () => {
        // Mint tokens to alice
        const quantity = 3n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Transfer token 2 to bob
        await nft.transferFrom(alice, bob, 2n, alice);

        // Alice should have tokens 1 and 3
        const aliceToken0 = await nft.tokenOfOwnerByIndex(alice, 0n);
        const aliceToken1 = await nft.tokenOfOwnerByIndex(alice, 1n);
        Assert.expect(aliceToken0).toEqual(1n);
        Assert.expect(aliceToken1).toEqual(3n);

        // Bob should have token 2
        const bobToken0 = await nft.tokenOfOwnerByIndex(bob, 0n);
        Assert.expect(bobToken0).toEqual(2n);
    });

    await vm.it('should fail to enumerate with out of bounds index', async () => {
        // Mint one token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        await Assert.expect(async () => {
            await nft.tokenOfOwnerByIndex(alice, 1n); // Index 1 doesn't exist (only 0)
        }).toThrow('Index out of bounds');
    });

    // ============= Safe Transfer Tests =============

    await vm.it('should perform safe transfer to EOA', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Safe transfer to bob (EOA)
        const data = new Uint8Array([1, 2, 3]);
        await nft.safeTransferFrom(alice, bob, 1n, data, alice);

        const owner = await nft.ownerOf(1n);
        Assert.expect(owner).toEqualAddress(bob);
    });

    // ============= Edge Case Tests =============

    await vm.it('should handle self-transfer gracefully', async () => {
        // Mint token to alice
        const quantity = 1n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        // Transfer to self (should be a no-op)
        await nft.transferFrom(alice, alice, 1n, alice);

        const owner = await nft.ownerOf(1n);
        Assert.expect(owner).toEqualAddress(alice);

        const balance = await nft.balanceOf(alice);
        Assert.expect(balance).toEqual(1n);
    });

    await vm.it('should get all tokens of owner', async () => {
        // Mint multiple tokens
        const quantity = 4n;
        const reservationFee = nft.calculateReservationFee(quantity);
        createTreasuryOutput(treasuryAddress, reservationFee);
        await nft.reserve(quantity, alice);
        clearOutputs();

        Blockchain.blockNumber = 1001n;
        createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
        await nft.claim(alice);
        clearOutputs();

        const tokens = await nft.getAllTokensOfOwner(alice);
        Assert.expect(tokens.length).toEqual(4);
        Assert.expect(tokens).toDeepEqual([1n, 2n, 3n, 4n]);
    });

    await vm.it('mint out', async () => {
        const quantity: bigint = BigInt(MAX_RESERVATION_AMOUNT);
        const reservationFee = nft.calculateReservationFee(quantity);

        const totalSupply: bigint = (await nft.maxSupply()) / quantity;

        const addresses: Address[] = [];
        for (let i = 0n; i < totalSupply; i++) {
            const addy = Blockchain.generateRandomAddress();
            addresses.push(addy);

            createTreasuryOutput(treasuryAddress, reservationFee);

            await nft.reserve(quantity, addy);
            clearOutputs();
        }

        Blockchain.log(`Reserved 10,000 NFTs`);

        Blockchain.blockNumber = 1001n;
        for (let i = 0; i < Number(totalSupply); i++) {
            createTreasuryOutput(treasuryAddress, nft.calculateRemainingPayment(quantity));
            const next = addresses[i];

            await nft.claim(next);
            clearOutputs();
        }

        const status = await nft.getStatus();
        Assert.expect(status.minted).toEqual(10000n);
        Assert.expect(status.available).toEqual(0n);
        Assert.expect(status.reserved).toEqual(0n);
    });
});
