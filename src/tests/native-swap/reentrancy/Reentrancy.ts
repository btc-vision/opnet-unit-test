import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { Assert, Blockchain, gas2USD, opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { ReentrantToken } from '../../../contracts/ReentrantToken.js';
import { Address } from '@btc-vision/transaction';
import { Recipient, ReserveResult } from '../../../contracts/NativeSwapTypes.js';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { createRecipientsOutput } from '../../utils/TransactionUtils.js';
import { BitcoinUtils } from 'opnet';

await opnet('Native Swap - Reentrancy', async (vm: OPNetUnit) => {
    let nativeSwap: NativeSwap;
    let token: ReentrantToken;
    const tokenDecimals = 18;
    const floorPrice: bigint = 10n ** 18n / 1500n; //10n ** 18n;
    const point25InitialLiquidity = 52_500n * 10n ** BigInt(tokenDecimals);
    const initialLiquidityProvider: Address = Blockchain.generateRandomAddress();
    const userAddress: Address = Blockchain.generateRandomAddress();
    const providerAddress: Address = Address.fromString(
        '0x3aa01777299ad13481fa067374fc369ace93b3c87da319934a6817c6c162a23d',
    );
    const tokenAddress: Address = Address.fromString(
        '0x2aa01777299ad13481fa067374fc369ace93b3c87da319934a6817c6c162a23e',
    );
    const ewmaAddress: Address = Address.fromString(
        '0x1aa01777299ad13481fa067374fc369ace93b3c87da319934a6817c6c162a23f',
    );

    let toSwap: { a: Address; r: Recipient[] }[] = [];

    async function listTokenRandom(
        l: bigint,
        provider: Address = Blockchain.generateRandomAddress(),
    ): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Transfer tokens from userAddress to provider
        await token.transfer(userAddress, provider, l);

        // Approve EWMA contract to spend tokens
        await token.approve(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: l,
            priority: false,
            disablePriorityQueueFees: false,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
    }

    async function reserve(amount: bigint, provider: Address): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const r = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: amount,
            minimumAmountOut: 0n,
            forLP: false,
        });

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            toSwap.push({
                a: provider,
                r: decoded.recipients,
            });
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        return r;
    }

    async function swapAll(): Promise<void> {
        const reservation = toSwap[0];
        Blockchain.txOrigin = reservation.a;
        Blockchain.msgSender = reservation.a;

        createRecipientsOutput(reservation.r);
        const s = await nativeSwap.swap({ token: tokenAddress });
        const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(
            s.response.events[s.response.events.length - 1].data,
        );

        vm.log(`Swapped spent ${gas2USD(s.response.usedGas)} USD in gas, ${d.amountOut} tokens`);

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    async function createNativeSwapPool(floorPrice: bigint, initLiquidity: bigint): Promise<void> {
        // Approve NativeSwap to take tokens
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        await token.approve(userAddress, nativeSwap.address, initLiquidity);

        // Create the pool
        await nativeSwap.createPool({
            token: token.address,
            floorPrice: floorPrice,
            initialLiquidity: initLiquidity,
            receiver: initialLiquidityProvider.p2tr(Blockchain.network),
            antiBotEnabledFor: 0,
            antiBotMaximumTokensPerReservation: 0n,
            maxReservesIn5BlocksPercent: 40,
        });

        Blockchain.blockNumber += 1n;
    }

    vm.beforeEach(async () => {
        Blockchain.blockNumber = 1n;

        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Instantiate and register the OP_20 token
        token = new ReentrantToken({
            file: 'ReentrantToken',
            deployer: userAddress,
            address: tokenAddress,
            decimals: tokenDecimals,
        });

        Blockchain.register(token);
        await token.init();

        const totalSupply = Blockchain.expandToDecimal(1_000_000_000_000, tokenDecimals);
        await token.mintRaw(userAddress, totalSupply);

        nativeSwap = new NativeSwap(userAddress, ewmaAddress);
        Blockchain.register(nativeSwap);
        await nativeSwap.init();

        await createNativeSwapPool(floorPrice, point25InitialLiquidity);
    });

    vm.afterEach(() => {
        nativeSwap.dispose();
        token.dispose();
        Blockchain.dispose();
        toSwap = [];
    });

    await vm.it('should revert when trying reentrancy call on reserve method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('reserve(address,uint256,uint256,bool)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on swap method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('swap(address)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on listLiquidity method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('listLiquidity(address,string,uint128,bool)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on cancelListing method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('cancelListing(address)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on addLiquidity method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('addLiquidity(address,string)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on removeLiquidity method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('removeLiquidity(address)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on createPool method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('createPool(address,uint256,uint128,string,uint16,uint256,uint16)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it(
        'should revert when trying reentrancy call on createPoolWithSignature method',
        async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            Blockchain.blockNumber += 1n;
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

            Blockchain.blockNumber += 1n;

            await reserve(20_000_000n, providerAddress);

            Blockchain.blockNumber += 3n;

            await token.setCallback(
                'createPoolWithSignature(bytes,address,uint256,uint256,uint128,string,uint16,uint256,uint16)',
            );

            await Assert.expect(async () => {
                await swapAll();
            }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
        },
    );

    await vm.it('should revert when trying reentrancy call on setFees method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('setFees(uint64,uint64)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it(
        'should revert when trying reentrancy call on setStakingContractAddress method',
        async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            Blockchain.blockNumber += 1n;
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

            Blockchain.blockNumber += 1n;

            await reserve(20_000_000n, providerAddress);

            Blockchain.blockNumber += 3n;

            await token.setCallback('setStakingContractAddress(address)');

            await Assert.expect(async () => {
                await swapAll();
            }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
        },
    );

    await vm.it('should revert when trying reentrancy call on getReserve method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('getReserve(address)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it('should revert when trying reentrancy call on getQuote method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('getQuote(address,uint256)');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it(
        'should revert when trying reentrancy call on getProviderDetails method',
        async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            Blockchain.blockNumber += 1n;
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

            Blockchain.blockNumber += 1n;

            await reserve(20_000_000n, providerAddress);

            Blockchain.blockNumber += 3n;

            await token.setCallback('getProviderDetails(address)');

            await Assert.expect(async () => {
                await swapAll();
            }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
        },
    );

    await vm.it(
        'should revert when trying reentrancy call on getPriorityQueueCost method',
        async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            Blockchain.blockNumber += 1n;
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

            Blockchain.blockNumber += 1n;

            await reserve(20_000_000n, providerAddress);

            Blockchain.blockNumber += 3n;

            await token.setCallback('getPriorityQueueCost');

            await Assert.expect(async () => {
                await swapAll();
            }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
        },
    );

    await vm.it('should revert when trying reentrancy call on getFees method', async () => {
        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        Blockchain.blockNumber += 1n;
        await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

        Blockchain.blockNumber += 1n;

        await reserve(20_000_000n, providerAddress);

        Blockchain.blockNumber += 3n;

        await token.setCallback('getFees');

        await Assert.expect(async () => {
            await swapAll();
        }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
    });

    await vm.it(
        'should revert when trying reentrancy call on getAntibotSettings method',
        async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            Blockchain.blockNumber += 1n;
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

            Blockchain.blockNumber += 1n;

            await reserve(20_000_000n, providerAddress);

            Blockchain.blockNumber += 3n;

            await token.setCallback('getAntibotSettings(address)');

            await Assert.expect(async () => {
                await swapAll();
            }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
        },
    );

    await vm.it(
        'should revert when trying reentrancy call on getStakingContractAddress method',
        async () => {
            Blockchain.txOrigin = userAddress;
            Blockchain.msgSender = userAddress;

            Blockchain.blockNumber += 1n;
            await listTokenRandom(BitcoinUtils.expandToDecimals(100, tokenDecimals));

            Blockchain.blockNumber += 1n;

            await reserve(20_000_000n, providerAddress);

            Blockchain.blockNumber += 3n;

            await token.setCallback('getStakingContractAddress');

            await Assert.expect(async () => {
                await swapAll();
            }).toThrow(/Error: Execution reverted: NATIVE_SWAP: LOCKED/);
        },
    );
});
