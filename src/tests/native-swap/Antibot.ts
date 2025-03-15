//
// 14) This test ensures anti-bot logic triggers if block <= queue.antiBotExpirationBlock
//     and user attempts to exceed anti-bot max tokens per reservation => revert.
//
/*await vm.it(
    'should revert if user tries to exceed anti-bot max tokens/reservation',
    async () => {
        Blockchain.txOrigin = testHelper.userAddress;
        Blockchain.msgSender = testHelper.userAddress;
        await testHelper.nativeSwap.createPool({
            token: testHelper.tokenAddress,
            floorPrice: 1n, // simplistic
            initialLiquidity: 5_000n,
            receiver: testHelper.initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 20,
            antiBotMaximumTokensPerReservation: 1_000n,
            maxReservesIn5BlocksPercent: 40,
        });

        // Now if user tries to reserve more than 1,000 tokens while anti-bot is active => revert
        const bigBuyer = Blockchain.generateRandomAddress();
        Blockchain.txOrigin = bigBuyer;
        Blockchain.msgSender = bigBuyer;

        await Assert.throwsAsync(async () => {
            await testHelper.nativeSwap.reserve({
                token: testHelper.tokenAddress,
                maximumAmountIn: 100_000_000n,
                minimumAmountOut: testHelper.scaleToken(2000n), // user wants 2k tokens
                forLP: false,
            });
        }, /Cannot exceed anti-bot max tokens\/reservation/i);
    },
);

//
// 15) Confirm it all works if the user requests a small amount under the anti-bot limit
//
await vm.it('should allow reservation under anti-bot limit', async () => {
    // We assume from the previous test that the pool is still there with antiBotEnabledFor=20
    // The chain's block is presumably small => we're within the anti-bot window
    // But if user requests fewer than 1_000 tokens => success
    const user = Blockchain.generateRandomAddress();
    Blockchain.txOrigin = user;
    Blockchain.msgSender = user;

    const r = await testHelper.nativeSwap.reserve({
        token: testHelper.tokenAddress,
        maximumAmountIn: 100_000_000n,
        minimumAmountOut: testHelper.scaleToken(500n),
        forLP: false,
    });

    const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
    Assert.toBeGreaterThanOrEqual(decoded.reservation?.expectedAmountOut || 0n, 500n);
});*/
