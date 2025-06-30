import { Address, BufferHelper } from '@btc-vision/transaction';
import { Recipient, ReserveResult } from '../../../contracts/NativeSwapTypes.js';
import {
    Assert,
    Blockchain,
    FastBigIntMap,
    gas2USD,
    OP_20,
    OPNetUnit,
    StateHandler,
} from '@btc-vision/unit-test-framework';
import { createRecipientsOutput } from '../../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../../contracts/NativeSwapTypesCoders.js';
import { BitcoinUtils } from 'opnet';
import { NativeSwap } from '../../../contracts/NativeSwap.js';
import { createReadStream } from 'fs';
import { chain } from 'stream-chain';
import streamJson from 'stream-json';
import streamArrayJson from 'stream-json/streamers/StreamArray';
import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const streamArray = streamArrayJson.streamArray;
const parser = streamJson.parser;

export const tokenDecimals = 18;

let toSwap: { a: Address; r: Recipient[] }[] = [];
let usedReservationAddresses: Address[] = [];

export function cleanupSwap(): void {
    toSwap = [];
}

export function getModifiedStates(states: FastBigIntMap, contract: Address) {
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

export function mergeStates(original: FastBigIntMap, toMerge: FastBigIntMap): FastBigIntMap {
    for (const [key, value] of toMerge.entries()) {
        original.set(key, value);
    }

    return original;
}

export async function addProviderLiquidity(
    token: OP_20,
    nativeSwap: NativeSwap,
    amountIn: bigint,
    priority: boolean = false,
    provider: Address = Blockchain.generateRandomAddress(),
): Promise<Address> {
    Blockchain.msgSender = provider;
    Blockchain.txOrigin = provider;

    await token.approve(provider, nativeSwap.address, amountIn);
    const resp = await nativeSwap.listLiquidity({
        token: token.address,
        receiver: provider.p2tr(Blockchain.network),
        amountIn: amountIn,
        priority: priority,
        disablePriorityQueueFees: false,
    });

    Assert.expect(resp.response.error).toBeUndefined();
    return provider;
}

export async function listTokenRandom(
    userAddress: Address,
    token: OP_20,
    nativeSwap: NativeSwap,
    vm: OPNetUnit,
    l: bigint,
    provider: Address = Blockchain.generateRandomAddress(),
    priority: boolean = false,
): Promise<void> {
    const backup = Blockchain.txOrigin;

    Blockchain.txOrigin = userAddress;
    Blockchain.msgSender = userAddress;

    // Transfer tokens from userAddress to provider
    await token.transfer(userAddress, provider, l);

    // Approve NativeSwap contract to spend tokens
    await token.approve(provider, nativeSwap.address, l);

    // Add liquidity
    Blockchain.txOrigin = provider;
    Blockchain.msgSender = provider;

    const liquid = await nativeSwap.listLiquidity({
        token: token.address,
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

export async function swapAll(
    token: OP_20,
    nativeSwap: NativeSwap,
    vm: OPNetUnit,
    userAddress: Address,
): Promise<void> {
    toSwap = shuffle(toSwap);

    for (let i = 0; i < toSwap.length; i++) {
        const reservation = toSwap[i];
        Blockchain.txOrigin = reservation.a;
        Blockchain.msgSender = reservation.a;

        createRecipientsOutput(reservation.r);
        const s = await nativeSwap.swap({ token: token.address });
        const d = NativeSwapTypesCoders.decodeSwapExecutedEvent(
            s.response.events[s.response.events.length - 1].data,
        );

        vm.log(`Swapped spent ${gas2USD(s.response.usedGas)} USD in gas, ${d.amountOut} tokens`);
    }

    Blockchain.txOrigin = userAddress;
    Blockchain.msgSender = userAddress;
    toSwap = [];
}

async function randomReserve(
    token: OP_20,
    nativeSwap: NativeSwap,
    vm: OPNetUnit,
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
        token: token.address,
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

export async function makeReservation(
    token: OP_20,
    nativeSwap: NativeSwap,
    vm: OPNetUnit,
    buyer: Address,
    satIn: bigint,
    minOut: bigint,
): Promise<ReserveResult> {
    usedReservationAddresses.push(buyer);

    Blockchain.msgSender = buyer;
    Blockchain.txOrigin = buyer;

    const resp = await nativeSwap.reserve({
        token: token.address,
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

const CACHE_DIR = path.resolve('cache');
mkdirSync(CACHE_DIR, { recursive: true });

type Latest = Map<string, { seenAt: bigint; valueB64: string | null }>;

export async function getStates(file: string, SEARCHED_BLOCK: bigint): Promise<FastBigIntMap> {
    const baseName = path.basename(file).replaceAll(path.sep, '_');
    const cachePath = path.join(CACHE_DIR, `cache-${baseName}-${SEARCHED_BLOCK.toString()}.json`);

    if (existsSync(cachePath)) {
        console.log(`Cache hit -> ${cachePath}`);
        const raw = readFileSync(cachePath, 'utf8');
        const array: [string, string][] = JSON.parse(raw) as [string, string][];

        const map = new FastBigIntMap();
        for (const [kHex, vHex] of array) {
            map.set(BigInt(`0x${kHex}`), BigInt(`0x${vHex}`));
        }
        console.log(`Loaded ${map.size} pointers from cache`);
        return map;
    }

    console.log(`Cache miss - loading states from ${file} at block ${SEARCHED_BLOCK}...`);

    const latest: Latest = new Map();

    const stream = chain([
        createReadStream(file, { encoding: 'utf8' }),
        parser({ jsonStreaming: true }),
        streamArray(),
    ]);

    for await (const data of stream as AsyncIterable<{ value: ParsedState }>) {
        const value = data.value;
        const ptrB64 = value.pointer.$binary.base64;
        const seenAt = BigInt(value.lastSeenAt.$numberLong);
        if (seenAt > SEARCHED_BLOCK) continue;

        const prev = latest.get(ptrB64);
        if (!prev || seenAt > prev.seenAt) {
            latest.set(ptrB64, {
                seenAt,
                valueB64: value.value?.$binary.base64 ?? null,
            });
        }
    }

    const map = new FastBigIntMap();
    for (const [ptrB64, { valueB64 }] of latest) {
        const ptrArr = Uint8Array.from(Buffer.from(ptrB64, 'base64'));
        if (ptrArr.length !== 32) {
            throw new Error(`Pointer must be 32 bytes, got ${ptrArr.length}.`);
        }
        const keyBig = BufferHelper.uint8ArrayToPointer(ptrArr);

        let valBig = 0n;
        if (valueB64) {
            const valArr = Uint8Array.from(Buffer.from(valueB64, 'base64'));
            if (valArr.length !== 32) {
                throw new Error(`Value must be 32 bytes, got ${valArr.length}.`);
            }
            valBig = BufferHelper.uint8ArrayToPointer(valArr);
        }

        map.set(keyBig, valBig);
    }

    const serialised: [string, string][] = [];
    for (const [k, v] of map) {
        const kHex = k.toString(16).padStart(64, '0');
        const vHex = v.toString(16).padStart(64, '0');
        serialised.push([kHex, vHex]);
    }

    writeFileSync(cachePath, JSON.stringify(serialised));
    console.log(`Cached ${map.size} pointers -> ${cachePath}`);

    return map;
}
