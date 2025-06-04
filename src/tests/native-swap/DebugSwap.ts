import { Address, BufferHelper } from '@btc-vision/transaction';
import {
    Assert,
    Blockchain,
    FastBigIntMap,
    gas2USD,
    OP_20,
    opnet,
    OPNetUnit,
    StateHandler,
} from '@btc-vision/unit-test-framework';

import fs from 'fs';
import { BitcoinUtils } from 'opnet';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import { Recipient, ReserveResult } from '../../contracts/NativeSwapTypes.js';
import { createRecipientsOutput } from '../utils/TransactionUtils.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';

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

const nativeStatesFile = './states/NativeSwapStates.json';
const motoStatesFile = './states/MotoStates.json';

function getStates(file: string): FastBigIntMap {
    const data = fs.readFileSync(file, 'utf8');
    const parsedData = JSON.parse(data) as ParsedStates;

    let parsedDeduped: ParsedStates = [];
    const seenAtPointers = new Map<string, { seenAt: number; value: string }>();
    for (const state of parsedData) {
        const pointer = state.pointer.$binary.base64;
        const at = Number(state.lastSeenAt.$numberLong);
        const value = state.value.$binary.base64;

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

        const pointerHex = Buffer.from(pointer, 'base64');
        const valueHex = Buffer.from(value, 'base64');

        const key = BufferHelper.uint8ArrayToPointer(Uint8Array.from(pointerHex));
        const val = BufferHelper.uint8ArrayToValue(Uint8Array.from(valueHex));

        map.set(key, val);
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
    '0xdb944e78cada1d705af892bb0560a4a9c4b9896d64ef23dfd3870ffd5004f4f2',
);

const nativeAddy: Address = Address.fromString(
    '0xec8ad18b56eb682755fdf8196698e18fcd872c8e53dbcfe5d183ba43c1ace061',
);

const userAddress: Address = Blockchain.generateRandomAddress();
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

    const token: OP_20 = new OP_20({
        file: 'moto',
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

        await token.approve(provider, nativeSwap.address, amountIn);
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
        await token.transfer(userAddress, provider, l);

        // Approve NativeSwap contract to spend tokens
        await token.approve(provider, nativeSwap.address, l);

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

        Blockchain.blockNumber = 4503298n;

        StateHandler.overrideStates(nativeAddy, nativeStates);
        StateHandler.overrideStates(tokenAddress, motoStates);

        StateHandler.overrideDeployment(tokenAddress);
        StateHandler.overrideDeployment(nativeAddy);
    });

    vm.afterEach(() => {
        Blockchain.dispose();
        Blockchain.cleanup();
    });
});
