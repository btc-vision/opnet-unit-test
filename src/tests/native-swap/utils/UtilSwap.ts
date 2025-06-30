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

type ParsedStates = ParsedState[];

export async function getStates(file: string, SEARCHED_BLOCK: bigint): Promise<FastBigIntMap> {
    console.log(`Loading states from ${file} at block ${SEARCHED_BLOCK}...`);

    const parsedData: ParsedStates = [];
    await new Promise<void>((resolve, reject) => {
        const pipeline = chain([
            createReadStream(file, { encoding: 'utf8' }),
            parser({ jsonStreaming: true }),
            streamArray(),
        ]);

        let count = 0;
        pipeline.on('data', (data: { value: unknown }) => {
            count++;

            const value = data.value as ParsedState;
            parsedData.push(value);
        });

        pipeline.on('error', reject);
        pipeline.on('end', () => {
            console.log(`Parsed ${count} states from ${file}.`);

            resolve();
        });
    });

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
                `Invalid state data: Pointer and value must be 32 bytes long. Got ${pointerHex.length} and ${valueHex.length} bytes.,`,
            );
        }

        const key = BufferHelper.uint8ArrayToPointer(pointerHex);
        const pointerValueBigInt = value ? BufferHelper.uint8ArrayToPointer(valueHex) : 0n;

        map.set(key, pointerValueBigInt);
    }

    console.log(`Loaded ${map.size} states from ${file} at block ${SEARCHED_BLOCK}.`);

    return map;
}
