import { Address } from '@btc-vision/transaction';
import { Assert, Blockchain, OP_20, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { NativeSwap } from '../../../contracts/ewma/NativeSwap.js';
import { NativeSwapTypesCoders } from '../../../contracts/ewma/NativeSwapTypesCoders.js';
import { createRecipientsOutput, gas2USD } from '../../utils/TransactionUtils.js';
import { BitcoinUtils } from 'opnet';
import { createRecipientUTXOs } from '../../utils/UTXOSimulator.js';
import { DummyStakingPool } from '../../../contracts/motoswap/DummyStakingPool.js';


await opnet('Native Swap - Staking Pool Fee Collection', async (vm: OPNetUnit) => {
  let nativeSwap: NativeSwap;
  let token: OP_20;
  let staking: DummyStakingPool;

  const tokenDecimals = 18;
  const point25InitialLiquidity = 52_500n * 10n ** BigInt(tokenDecimals);
  const initialLiquidity = 1_000_000n * 10n ** BigInt(tokenDecimals); //20_947_500n

  const liquidityProviderAddress: Address = Blockchain.generateRandomAddress();
  const userAddress: Address = Blockchain.generateRandomAddress();
  const tokenAddress: Address = Blockchain.generateRandomAddress();
  const nativeSwapAddress: Address = Blockchain.generateRandomAddress();
  const stakingContractAddress: Address = Blockchain.generateRandomAddress();

  const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();

  const floorPrice: bigint = 1n

  /**
   * Helper: Create the NativeSwap pool with initial liquidity
   */
  async function createNativeSwapPool(floorPrice: bigint, initLiquidity: bigint): Promise<void> {
    // Approve NativeSwap to take tokens
    Blockchain.txOrigin = liquidityProviderAddress;
    Blockchain.msgSender = liquidityProviderAddress;
    await token.approve(liquidityProviderAddress, nativeSwap.address, initLiquidity);

    // Create the pool
    await nativeSwap.createPool({
      token: token.address,
      floorPrice: floorPrice,
      initialLiquidity: initLiquidity,
      receiver: initialLiquidityProvider.p2tr(Blockchain.network),
      antiBotEnabledFor: 0,
      antiBotMaximumTokensPerReservation: 0n,
      maxReservesIn5BlocksPercent: 4000,
    });

    Blockchain.blockNumber += 1n;
  }

  vm.beforeEach(async () => {
    Blockchain.blockNumber = 1n;

    // Reset blockchain state
    Blockchain.dispose();
    Blockchain.clearContracts();
    await Blockchain.init();

    Blockchain.txOrigin = liquidityProviderAddress;
    Blockchain.msgSender = liquidityProviderAddress;

    // Instantiate and register the OP_20 token
    token = new OP_20({
      file: 'MyToken',
      deployer: liquidityProviderAddress,
      address: tokenAddress,
      decimals: tokenDecimals,
    });

    Blockchain.register(token);
    await token.init();

    staking = new DummyStakingPool(liquidityProviderAddress, stakingContractAddress)
    Blockchain.register(staking);
    await staking.init()

    // Mint tokens to the user
    const totalSupply = 1_000_000n * 10n ** 18n
    await token.mintRaw(liquidityProviderAddress, totalSupply);

    // Instantiate and register the nativeSwap contract
    nativeSwap = new NativeSwap(liquidityProviderAddress, nativeSwapAddress);
    Blockchain.register(nativeSwap);
    await nativeSwap.init();

    await nativeSwap.setStakingContractAddress(stakingContractAddress);

    // Add liquidity
    await createNativeSwapPool(floorPrice, totalSupply);
  });

  vm.afterEach(() => {
    nativeSwap.dispose();
    token.dispose();
    Blockchain.dispose();
  });

  await vm.it('should collect fees for staking contract with simple number', async () => {
    Blockchain.txOrigin = userAddress
    Blockchain.msgSender = userAddress

    const swapAmount = 10000n
    const reservation = await nativeSwap.reserve({
      token: tokenAddress,
      maximumAmountIn: swapAmount,
      minimumAmountOut: 1n,
      forLP: false,
    })
    const preBalance = await token.balanceOf(userAddress)

    const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
      reservation.response.events,
    );
    createRecipientUTXOs(decodedReservation.recipients);

    Blockchain.blockNumber = Blockchain.blockNumber + 1n

    await nativeSwap.swap({
      token: tokenAddress,
      isSimulation: false
    })

    const expectedFee = (swapAmount * 20n) / 1000n
    const expectedOutAmount = swapAmount - expectedFee
    const postBalance = await token.balanceOf(userAddress)
    const stakingPoolBalance = await token.balanceOf(stakingContractAddress)

    console.log(`Pre: ${preBalance} Post: ${postBalance}, expectedOutAmount: ${expectedOutAmount} Staking: ${stakingPoolBalance}`)
    Assert.expect(stakingPoolBalance).toEqual(expectedFee)
    Assert.expect(postBalance).toEqual(preBalance + expectedOutAmount)
  });

  const swapAmountsToTest: bigint[] = [
    18576187456n,
    89876517346n,
    43789523978572n,
    8n * 10n ** 18n,
    13n * 10n ** 18n,
  ]

  for (let i = 0; i < swapAmountsToTest.length; i++) {
    await vm.it(`should collect fees for staking contract, test ${i}`, async () => {
      Blockchain.txOrigin = userAddress
      Blockchain.msgSender = userAddress

      const swapAmount = swapAmountsToTest[i]
      const reservation = await nativeSwap.reserve({
        token: tokenAddress,
        maximumAmountIn: swapAmount,
        minimumAmountOut: 1n,
        forLP: false,
      })
      const preBalance = await token.balanceOf(userAddress)

      const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
        reservation.response.events,
      );
      createRecipientUTXOs(decodedReservation.recipients);

      Blockchain.blockNumber = Blockchain.blockNumber + 1n

      await nativeSwap.swap({
        token: tokenAddress,
        isSimulation: false
      })

      const expectedFee = (swapAmount * 20n) / 1000n
      const expectedOutAmount = swapAmount - expectedFee
      const postBalance = await token.balanceOf(userAddress)
      const stakingPoolBalance = await token.balanceOf(stakingContractAddress)

      Assert.expect(stakingPoolBalance).toEqual(expectedFee)
      Assert.expect(postBalance).toEqual(preBalance + expectedOutAmount)
    });
  }
});