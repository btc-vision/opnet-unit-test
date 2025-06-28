import { Address, BufferHelper } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    FastBigIntMap,
    gas2USD,
    OP20,
    opnet,
    OPNetUnit,
    StateHandler,
} from '@btc-vision/unit-test-framework';

import fs from 'fs';
import { BitcoinUtils } from 'opnet';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    Recipient,
    ReserveParams,
    ReserveResult,
    SwapParams,
} from '../../contracts/NativeSwapTypes.js';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { Network, networks } from '@btc-vision/bitcoin';
import {
    logCancelListingEvents,
    logCancelListingResult,
    logLiquidityListedEvent,
} from '../utils/LoggerHelper.js';

interface ParsedState {
    readonly pointer: {
        $binary: {
            base64: string;
        };
    };
    readonly value: {
        $binary: {
            base64: string;
        };
    };
    readonly lastSeenAt: {
        $numberLong: string;
    };
}

type ParsedStates = ParsedState[];

const nativeStatesFile = './states/NativeSwapStates2.json';
const motoStatesFile = './states/MotoStates2.json';

// listed at:13826n
// add to purge at: 13838n???
// purged at:13907n

const SEARCHED_BLOCK: bigint = 13838n; //13826n;13836n;13907n
function getStates(file: string): FastBigIntMap {
    const data = fs.readFileSync(file, 'utf8');
    const parsedData = JSON.parse(data) as ParsedStates;

    let parsedDeduped: ParsedStates = [];
    const seenAtPointers = new Map<string, { seenAt: number; value: string }>();
    for (const state of parsedData) {
        const pointer = state.pointer.$binary.base64;
        const at = Number(state.lastSeenAt.$numberLong);
        const value = state.value.$binary.base64;

        if (BigInt(state.lastSeenAt.$numberLong) > SEARCHED_BLOCK) {
            continue;
        }

        const existing = seenAtPointers.get(pointer);
        if (existing) {
            if (at > existing.seenAt) {
                seenAtPointers.set(pointer, { seenAt: at, value });
            }
        } else {
            seenAtPointers.set(pointer, { seenAt: at, value });
        }
    }

    for (const [pointer, { seenAt, value }] of seenAtPointers.entries()) {
        parsedDeduped.push({
            pointer: {
                $binary: {
                    base64: pointer,
                },
            },
            value: {
                $binary: {
                    base64: value,
                },
            },
            lastSeenAt: {
                $numberLong: seenAt.toString(),
            },
        });
    }

    const map: FastBigIntMap = new FastBigIntMap();
    for (const state of parsedDeduped) {
        const pointer = state.pointer.$binary.base64;
        const value = state.value.$binary.base64;

        const pointerHex = Uint8Array.from(Buffer.from(pointer, 'base64'));
        const valueHex = Uint8Array.from(Buffer.from(value, 'base64'));
        if (pointerHex.length !== 32 || valueHex.length !== 32) {
            throw new Error(
                `Invalid state data: Pointer and value must be 32 bytes long. Got ${pointerHex.length} and ${valueHex.length} bytes.`,
            );
        }

        const key = BufferHelper.uint8ArrayToPointer(pointerHex);
        const pointerValueBigInt = value ? BufferHelper.uint8ArrayToPointer(valueHex) : 0n;

        map.set(key, pointerValueBigInt);
    }

    return map;
}

function getModifiedStates(states: FastBigIntMap, contract: Address) {
    const currentStates = StateHandler.getStates(contract);
    const modifiedStates = new FastBigIntMap();

    for (const [key, value] of states.entries()) {
        const currentValue = currentStates.get(key);
        if (currentValue === undefined) continue;

        if (currentValue !== value) {
            modifiedStates.set(key, currentValue);
        }
    }

    return modifiedStates;
}

function mergeStates(original: FastBigIntMap, toMerge: FastBigIntMap): FastBigIntMap {
    for (const [key, value] of toMerge.entries()) {
        original.set(key, value);
    }

    return original;
}

const admin: Address = Address.fromString(
    '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
);

const tokenAddress: Address = Address.fromString(
    `0x5fbbe156d169583b52fde0b819df0a135ca01534f86fe557a9cd9487bba599e0`, //'0xdb944e78cada1d705af892bb0560a4a9c4b9896d64ef23dfd3870ffd5004f4f2',
);

const nativeAddy: Address = Address.fromString(
    '0x2a207fb02a5938b463ae8f43d0dde11581e0ca520b206b6ba3eff4ca8245eca2',
);

const userAddress: Address = Address.fromString(
    '0x02729c84e0174d1a2c1f089dd685bdaf507581762c85bfcf69c7ec90cf2ba596b9',
); //Blockchain.generateRandomAddress();
const tokenDecimals = 18;

let toSwap: { a: Address; r: Recipient[] }[] = [];
let usedReservationAddresses: Address[] = [];

await opnet('NativeSwap: Debug', async (vm: OPNetUnit) => {
    Blockchain.msgSender = admin;
    Blockchain.txOrigin = admin;

    const nativeStates = getStates(nativeStatesFile);
    const motoStates = getStates(motoStatesFile);

    const nativeSwap: NativeSwap = new NativeSwap(admin, nativeAddy);
    Blockchain.register(nativeSwap);

    const token: OP20 = new OP20({
        file: 'MyToken',
        deployer: userAddress,
        address: tokenAddress,
        decimals: tokenDecimals,
    });
    Blockchain.register(token);

    async function addProviderLiquidity(
        amountIn: bigint,
        priority: boolean = false,
    ): Promise<Address> {
        const provider = Blockchain.generateRandomAddress();
        Blockchain.msgSender = provider;
        Blockchain.txOrigin = provider;

        await token.increaseAllowance(provider, nativeSwap.address, amountIn);
        const resp = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: amountIn,
            priority: priority,
            disablePriorityQueueFees: false,
        });

        Assert.expect(resp.response.error).toBeUndefined();
        return provider;
    }

    async function listTokenRandom(
        l: bigint,
        provider: Address = Blockchain.generateRandomAddress(),
        priority: boolean = false,
    ): Promise<void> {
        const backup = Blockchain.txOrigin;

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;

        // Transfer tokens from userAddress to provider
        await token.safeTransfer(userAddress, provider, l);

        // Approve NativeSwap contract to spend tokens
        await token.increaseAllowance(provider, nativeSwap.address, l);

        // Add liquidity
        Blockchain.txOrigin = provider;
        Blockchain.msgSender = provider;

        const liquid = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: provider.p2tr(Blockchain.network),
            amountIn: l,
            priority: priority,
            disablePriorityQueueFees: false,
        });

        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;

        vm.info(`Added liquidity for ${l} tokens - ${gas2USD(liquid.response.usedGas)} USD`);
    }

    const shuffle = <T>(array: T[]) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    };

    async function swapAll(): Promise<void> {
        toSwap = shuffle(toSwap);

        for (let i = 0; i < toSwap.length; i++) {
            const reservation = toSwap[i];
            Blockchain.txOrigin = reservation.a;
            Blockchain.msgSender = reservation.a;

            createRecipientsOutput(reservation.r);
            const s = await nativeSwap.swap({ token: tokenAddress });
            const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(
                s.response.events[s.response.events.length - 1].data,
            );

            vm.log(
                `Swapped spent ${gas2USD(s.response.usedGas)} USD in gas, ${d.amountOut} tokens`,
            );
        }

        Blockchain.txOrigin = userAddress;
        Blockchain.msgSender = userAddress;
        toSwap = [];
    }

    async function randomReserve(
        amount: bigint,
        forLP: boolean = false,
        rnd: boolean = true,
        reuse: boolean = false,
    ): Promise<ReserveResult> {
        const backup = Blockchain.txOrigin;

        let provider: Address = Blockchain.txOrigin;
        if (rnd) {
            if (reuse) {
                provider = usedReservationAddresses.shift() as Address;

                if (!provider) {
                    throw new Error(`No more addresses to reuse`);
                }
            } else {
                provider = Blockchain.generateRandomAddress();
            }

            Blockchain.txOrigin = provider;
            Blockchain.msgSender = provider;
        }

        const r = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: amount,
            minimumAmountOut: 0n,
            forLP: forLP,
            activationDelay: 0,
        });

        const decoded = NativeSwapTypesCoders.decodeReservationEvents(r.response.events);
        if (decoded.recipients.length) {
            if (forLP) {
                throw new Error('Cannot reserve for LP');
            } else {
                toSwap.push({
                    a: provider,
                    r: decoded.recipients,
                });
            }
        } else {
            vm.fail('No recipients found in reservation (swap) event.');
        }

        vm.info(
            `Reserved ${BitcoinUtils.formatUnits(r.expectedAmountOut, tokenDecimals)} tokens (${gas2USD(r.response.usedGas)} USD in gas) for ${provider} with ${decoded.recipients.length} recipients, amount of sat requested: ${decoded.totalSatoshis}`,
        );

        // Reset
        Blockchain.txOrigin = backup;
        Blockchain.msgSender = backup;
        return r;
    }

    async function makeReservation(
        buyer: Address,
        satIn: bigint,
        minOut: bigint,
    ): Promise<ReserveResult> {
        usedReservationAddresses.push(buyer);

        Blockchain.msgSender = buyer;
        Blockchain.txOrigin = buyer;

        const resp = await nativeSwap.reserve({
            token: tokenAddress,
            maximumAmountIn: satIn,
            minimumAmountOut: minOut,
            forLP: false,
        });

        vm.info(
            `Reserved ${BitcoinUtils.formatUnits(resp.expectedAmountOut, tokenDecimals)} tokens (${gas2USD(resp.response.usedGas)} USD in gas)`,
        );

        Assert.expect(resp.response.error).toBeUndefined();

        return resp;
    }

    vm.beforeEach(async () => {
        toSwap = [];

        await Blockchain.init();

        Blockchain.blockNumber = SEARCHED_BLOCK + 1n;

        StateHandler.overrideStates(nativeAddy, nativeStates);
        StateHandler.overrideStates(tokenAddress, motoStates);

        StateHandler.overrideDeployment(nativeAddy);
        StateHandler.overrideDeployment(tokenAddress);
    });

    vm.afterEach(() => {
        Blockchain.dispose();
        Blockchain.cleanup();
    });

    await vm.it('should debug', async () => {
        Blockchain.blockNumber = SEARCHED_BLOCK + 1n;
        Blockchain.network = networks.regtest;

        const addy = Address.fromString(
            '0x02338f02fd8f3575f00e81f4c39b88b8ceb0adfb99c116facd1b770554262066af',
        );

        Blockchain.msgSender = addy;
        Blockchain.txOrigin = addy;

        let details = await nativeSwap.getProviderDetails({ token: tokenAddress });
        console.log(`Block: ${Blockchain.blockNumber}`);
        console.log(`Provider details`);
        console.log(`---------------------`);
        console.log(`id: ${details.id}`);
        console.log(`liquidity: ${details.liquidity}`);
        console.log(`isPurged: ${details.isPurged}`);
        console.log(`purgeIndex: ${details.purgeIndex}`);
        console.log(`reserved: ${details.reserved}`);
        console.log(`listedTokenAt: ${details.listedTokenAt}`);
        console.log(`isActive: ${details.isActive}`);
        console.log(`queueIndex: ${details.queueIndex}`);
        console.log(`btcReceiver: ${details.btcReceiver}`);
        console.log(`isPriority: ${details.isPriority}`);

        let qd = await nativeSwap.getQueueDetails({ token: tokenAddress });

        console.log(qd);
        /*
        const r = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        const addr = Blockchain.generateRandomAddress();
        Blockchain.msgSender = addr;
        Blockchain.txOrigin = addr;
        const swapParams: ReserveParams = {
            token: tokenAddress,
            maximumAmountIn: 100000n,
            minimumAmountOut: 0n,
            forLP: false,
            activationDelay: 2,
        };

        createRecipientsOutput([
            {
                address: NativeSwap.feeRecipientTestnet,
                amount: NativeSwap.reservationFees,
                providerId: '',
            },
        ]);

        const t = await nativeSwap.reserve(swapParams);

        Blockchain.msgSender = addy;
        Blockchain.txOrigin = addy;

        details = await nativeSwap.getProviderDetails({ token: tokenAddress });
        console.log(`Block: ${Blockchain.blockNumber}`);
        console.log(`Provider details`);
        console.log(`---------------------`);
        console.log(`id: ${details.id}`);
        console.log(`liquidity: ${details.liquidity}`);
        console.log(`isPurged: ${details.isPurged}`);
        console.log(`purgeIndex: ${details.purgeIndex}`);
        console.log(`reserved: ${details.reserved}`);
        console.log(`listedTokenAt: ${details.listedTokenAt}`);
        console.log(`isActive: ${details.isActive}`);
        console.log(`queueIndex: ${details.queueIndex}`);
        console.log(`btcReceiver: ${details.btcReceiver}`);
        console.log(`isPriority: ${details.isPriority}`);

        qd = await nativeSwap.getQueueDetails({ token: tokenAddress });
        console.log(qd);
*/
        /*
        let detailPool = await nativeSwap.getReserve({ token: tokenAddress });
        console.log('');
        console.log(`Pool details`);
        console.log(`--------------------`);
        console.log(`liquidity: ${detailPool.liquidity}`);
        console.log(`reserved: ${detailPool.reservedLiquidity}`);
        console.log(`virtualTokenReserve: ${detailPool.virtualTokenReserve}`);

        let b = await token.balanceOf(nativeSwap.address);
        console.log('');
        console.log(`balanceOf`);
        console.log(`--------------------`);
        console.log(b);
        
 */
        /*
        console.log('cancel');
        console.log(`--------------------`);
        const r = await nativeSwap.cancelListing({ token: tokenAddress });
        logCancelListingResult(r);
        logCancelListingEvents(r.response.events);
        console.log('');
        */

        /*
        details = await nativeSwap.getProviderDetails({ token: tokenAddress });
        console.log(`Block: ${Blockchain.blockNumber}`);
        console.log(`Provider details`);
        console.log(`---------------------`);
        console.log(`liquidity: ${details.liquidity}`);
        console.log(`purgeIndex: ${details.purgeIndex}`);
        console.log(`reserved: ${details.reserved}`);
        console.log(`listedTokenAt: ${details.listedTokenAt}`);
        console.log(`isActive: ${details.isActive}`);
        console.log(`queueIndex: ${details.queueIndex}`);
        console.log(`btcReceiver: ${details.btcReceiver}`);
        console.log(`isPriority: ${details.isPriority}`);

        detailPool = await nativeSwap.getReserve({ token: tokenAddress });
        console.log('');
        console.log(`Pool details`);
        console.log(`--------------------`);
        console.log(`liquidity: ${detailPool.liquidity}`);
        console.log(`reserved: ${detailPool.reservedLiquidity}`);
        console.log(`virtualTokenReserve: ${detailPool.virtualTokenReserve}`);

        b = await token.balanceOf(nativeSwap.address);
        console.log('');
        console.log(`balanceOf`);
        console.log(`--------------------`);
        console.log(b);
*/
        /*
        const b = await token.balanceOf(addy);

        await token.increaseAllowance(addy, nativeSwap.address, b);

        createRecipientsOutput([
            {
                address: NativeSwap.feeRecipientTestnet,
                amount: 50000n,
                providerId: '',
            },
        ]);

        const liquid = await nativeSwap.listLiquidity({
            token: tokenAddress,
            receiver: `tb1pazh3qsg4xm54wyk6g347u4e2vwvff73sj62f7l8r7aajrlj4sdzs8kga5m`,
            amountIn: b,
            priority: true,
            disablePriorityQueueFees: false,
        });
*/
        /*
        const r = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        const swapParams: ReserveParams = {
            token: tokenAddress,
            maximumAmountIn: 100000n,
            minimumAmountOut: 0n,
            forLP: false,
            activationDelay: 2,
        };

        createRecipientsOutput([
            {
                address: NativeSwap.feeRecipientTestnet,
                amount: NativeSwap.reservationFees,
                providerId: '',
            },
        ]);

        const t = await nativeSwap.reserve(swapParams);
*/
        /*createRecipientsOutput([
            {
                address: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcezf',
                amount: 10001n,
                providerId: '',
            },
            {
                address: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcezf',
                amount: 10001n,
                providerId: '',
            },
            {
                address: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcezf',
                amount: 10001n,
                providerId: '',
            },
        ]);

        const t = await nativeSwap.swap(swapParams);
        console.log(t);
*/
        /*

        const f = await nativeSwap.getQueueDetails({
            token: tokenAddress,
        });

        const d = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        console.log(r, f, d);*/
    });

    /*await vm.it('should debug', async () => {
        //Blockchain.blockNumber = 4503299n;
        Blockchain.blockNumber = 4503801n;

        const balance = await token.balanceOf(userAddress);
        vm.info(`User balance: ${BitcoinUtils.formatUnits(balance, tokenDecimals)} tokens`);

        //await listTokenRandom(
        //    BitcoinUtils.expandToDecimals(100_000_000, tokenDecimals),
        //    user,
        //    true,
        //);

        for (let i = 0; i < 100; i++) {
            const user = Blockchain.generateRandomAddress();
            await listTokenRandom(BitcoinUtils.expandToDecimals(1_000, tokenDecimals), user, true);

            Blockchain.blockNumber++;
        }

        const r = await nativeSwap.getReserve({
            token: tokenAddress,
        });

        const maxLeftInPool = r.liquidity - r.reservedLiquidity;
        vm.info(
            `Current reserve: ${BitcoinUtils.formatUnits(r.liquidity, tokenDecimals)} tokens, reserved: ${BitcoinUtils.formatUnits(r.reservedLiquidity, tokenDecimals)} tokens, max left in pool: ${BitcoinUtils.formatUnits(maxLeftInPool, tokenDecimals)} tokens`,
        );

        const currentQuote = await nativeSwap.getQuote({
            token: tokenAddress,
            satoshisIn: 100_000_000n, // 1 BTC
        });

        const maxCostSatoshis = tokensToSatoshis(maxLeftInPool, currentQuote.price);
        vm.info(
            `Current quote for 1 BTC: ${BitcoinUtils.formatUnits(currentQuote.tokensOut, tokenDecimals)} tokens, cost in satoshis: ${currentQuote.requiredSatoshis}, max cost in satoshis: ${maxCostSatoshis} (${BitcoinUtils.formatUnits(maxCostSatoshis, 8)} BTC)`,
        );

        const user = Blockchain.generateRandomAddress();
        const reservation = await makeReservation(user, maxCostSatoshis, 0n);
        const reservedMax = BitcoinUtils.formatUnits(reservation.totalSatoshis, 8);
        Blockchain.info(
            `Reserved ${reservedMax} BTC for user ${user} with ${reservation.expectedAmountOut} tokens expected out.`,
        );
    });*/
});
