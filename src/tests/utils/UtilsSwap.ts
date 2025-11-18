import { Address, BufferHelper } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    FastBigIntMap,
    gas2USD,
    OP20,
    OPNetUnit,
    StateHandler,
} from '@btc-vision/unit-test-framework';
import { BitcoinUtils } from 'opnet';
import { createReadStream } from 'fs';
import { chain } from 'stream-chain';
import streamJson from 'stream-json';
import streamArrayJson from 'stream-json/streamers/StreamArray';
import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { createRecipientsOutput } from './TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { Recipient, ReserveResult } from '../../contracts/NativeSwapTypes.js';
import * as inspector from 'node:inspector';

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
    token: OP20,
    nativeSwap: NativeSwap,
    amountIn: bigint,
    priority: boolean = false,
    provider: Address = Blockchain.generateRandomAddress(),
): Promise<Address> {
    Blockchain.msgSender = provider;
    Blockchain.txOrigin = provider;

    await token.increaseAllowance(provider, nativeSwap.address, amountIn);

    const csv1 = provider.toCSV(1n, Blockchain.network);
    const resp = await nativeSwap.listLiquidity({
        token: token.address,
        receiver: provider,
        receiverStr: csv1.address,
        network: Blockchain.network,
        amountIn: amountIn,
        priority: priority,
        disablePriorityQueueFees: false,
    });

    Assert.expect(resp.response.error).toBeUndefined();
    return provider;
}

export async function listTokenRandom(
    userAddress: Address,
    token: OP20,
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
    await token.safeTransfer(userAddress, provider, l);

    // Approve NativeSwap contract to spend tokens
    await token.increaseAllowance(provider, nativeSwap.address, l);

    // Add liquidity
    Blockchain.txOrigin = provider;
    Blockchain.msgSender = provider;

    const csv1 = provider.toCSV(1n, Blockchain.network);
    const liquid = await nativeSwap.listLiquidity({
        token: token.address,
        receiver: provider,
        receiverStr: csv1.address,
        network: Blockchain.network,
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
    token: OP20,
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
    token: OP20,
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
    token: OP20,
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
    });

    vm.info(
        `Reserved ${BitcoinUtils.formatUnits(resp.expectedAmountOut, tokenDecimals)} tokens (${gas2USD(resp.response.usedGas)} USD in gas)`,
    );

    Assert.expect(resp.response.error).toBeUndefined();

    return resp;
}

/*interface ParsedState {
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
}*/

interface ParsedState {
    readonly pointer: string;
    readonly value: string;
    readonly lastSeenAt: number;
}

const CACHE_DIR = path.resolve('cache');
mkdirSync(CACHE_DIR, { recursive: true });

type Latest = Map<string, { seenAt: bigint; valueB64: string | null }>;

async function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getStates(file: string, SEARCHED_BLOCK: bigint): Promise<FastBigIntMap> {
    const baseName = path.basename(file).replaceAll(path.sep, '_');
    const cachePath = path.join(CACHE_DIR, `cache-${baseName}-${SEARCHED_BLOCK.toString()}.json`);

    /*if (existsSync(cachePath)) {
        console.log(`Cache hit -> ${cachePath}`);
        const raw = readFileSync(cachePath, 'utf8');
        const array: [string, string][] = JSON.parse(raw) as [string, string][];

        console.log(`Deserializing ${array.length} pointers from cache...`);

        let startLoad = performance.now();
        const map = new FastBigIntMap();

        let c = 0;
        for (const [kHex, vHex] of array) {
            const tookElemRead = performance.now();
            if (c % 2000 === 0)
                console.log(
                    `Pointer: ${c} | Took ${(tookElemRead - startLoad).toFixed(4)}ms to read element from cache`,
                );

            const writeElem = performance.now();
            map.set(BigInt(`0x${kHex}`), BigInt(`0x${vHex}`));

            const writeEnd = performance.now();
            if (c % 2000 === 0) {
                console.log(
                    `Pointer: ${c} | Took ${(writeEnd - writeElem).toFixed(4)}ms to write element to map`,
                );
                startLoad = writeEnd;
            }
            c++;
        }
        const endLoad = performance.now();

        console.log(
            `Loaded ${map.size} pointers from cache in ${(endLoad - startLoad).toFixed(2)}ms`,
        );
        console.log(`Average per entry: ${((endLoad - startLoad) / array.length).toFixed(4)}ms`);
        return map;
    }*/

    await wait(5000);

    if (existsSync(cachePath)) {
        console.log(`Cache hit -> ${cachePath}`);
        const raw = readFileSync(cachePath, 'utf8');
        const array: [string, string][] = JSON.parse(raw) as [string, string][];

        console.log(`Deserializing ${array.length} pointers from cache...`);

        const map = new FastBigIntMap();

        const session = new inspector.Session();
        session.connect();

        let profilingStarted = false;

        let destructureTime = 0;
        let bigintConvTime = 0;
        let mapSetTime = 0;

        let maxSetTime = 0;
        let maxSetIndex = 0;
        let minSetTime = Infinity;

        for (let i = 0; i < array.length; i++) {
            // Start CPU profiler at 229K
            if (i === 229000) {
                console.log('\n=== STARTING CPU PROFILER ===');
                session.post('Profiler.enable');
                session.post('Profiler.start');
                profilingStarted = true;
            }

            // Take heap snapshots at key points
            /*if (i === 230000 || i === 232000 || i === 234000) {
                const snapshot = v8.writeHeapSnapshot(`./heap-${i}.heapsnapshot`);
                console.log(`Heap snapshot: ${snapshot}`);
            }*/

            const t0 = performance.now();
            const [kHex, vHex] = array[i];
            const t1 = performance.now();
            const destructTime = t1 - t0;

            const keyBigInt = BigInt(`0x${kHex}`);
            const valBigInt = BigInt(`0x${vHex}`);
            const t2 = performance.now();
            const bigintTime = t2 - t1;

            map.set(keyBigInt, valBigInt);
            const t3 = performance.now();
            const setTime = t3 - t2;

            if (setTime > maxSetTime) {
                maxSetTime = setTime;
                maxSetIndex = i;
            }
            if (setTime < minSetTime) {
                minSetTime = setTime;
            }

            destructureTime += destructTime;
            bigintConvTime += bigintTime;
            mapSetTime += setTime;

            if (i % 2000 === 0) {
                const heapUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
                const heapTotal = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2);

                console.log(
                    `Entry ${i}: avg_set=${(mapSetTime / 2000).toFixed(6)}ms min=${minSetTime.toFixed(6)}ms max=${maxSetTime.toFixed(6)}ms @${maxSetIndex} | heap=${heapUsed}/${heapTotal}MB`,
                );
                destructureTime = 0;
                bigintConvTime = 0;
                mapSetTime = 0;
                maxSetTime = 0;
                minSetTime = Infinity;
            }

            // Stop profiling at 235K
            if (i === 294000 && profilingStarted) {
                console.log('\n=== STOPPING CPU PROFILER ===');
                session.post('Profiler.stop', (err, result) => {
                    if (!err && result.profile) {
                        writeFileSync('./cpu-profile.cpuprofile', JSON.stringify(result.profile));
                        console.log('CPU profile written to cpu-profile.cpuprofile');
                        console.log(
                            'Import this file in Chrome DevTools > Performance > Load Profile',
                        );
                    }
                    session.disconnect();
                });
            }
        }

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
        const ptrB64 = value.pointer;
        const seenAt = BigInt(value.lastSeenAt);
        if (seenAt > SEARCHED_BLOCK) continue;

        const prev = latest.get(ptrB64);
        if (!prev || seenAt > prev.seenAt) {
            latest.set(ptrB64, {
                seenAt,
                valueB64: value.value ?? null,
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
