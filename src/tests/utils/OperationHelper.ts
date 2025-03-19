import { Address } from '@btc-vision/transaction';
import { Blockchain, OP_20 } from '@btc-vision/unit-test-framework';
import {
    logAction,
    logCreatePoolResult,
    logGetQuoteResult,
    logGetReserveResult,
    logRecipient,
    logReserveResult,
    logSwapExecutedEvent,
    logSwapResult,
} from './LoggerHelper.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { createRecipientUTXOs } from './UTXOSimulator.js';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    CreatePoolResult,
    GetQuoteResult,
    GetReserveResult,
    Recipient,
    ReserveResult,
    SwapResult,
} from '../../contracts/NativeSwapTypes.js';

export interface ReserveData {
    provider: Address;
    recipient: Recipient;
}

export async function helper_createPool(
    nativeSwap: NativeSwap,
    token: OP_20,
    owner: Address,
    receiver: Address,
    tokenLiquidityToApprove: number,
    floorPrice: bigint,
    poolInitialLiquidity: bigint,
    maxReservesIn5BlocksPercent: number = 60,
    log: boolean = true,
): Promise<CreatePoolResult> {
    if (log) {
        logAction('createPool');
    }

    const liquidityAmount: bigint = Blockchain.expandToDecimal(
        tokenLiquidityToApprove,
        token.decimals,
    );

    Blockchain.txOrigin = owner;
    Blockchain.msgSender = owner;

    await token.approve(owner, nativeSwap.address, liquidityAmount);

    const result = await nativeSwap.createPool({
        token: token.address,
        floorPrice: floorPrice,
        initialLiquidity: poolInitialLiquidity,
        receiver: receiver.p2tr(Blockchain.network),
        antiBotEnabledFor: 0,
        antiBotMaximumTokensPerReservation: 0n,
        maxReservesIn5BlocksPercent: maxReservesIn5BlocksPercent,
    });

    if (log) {
        logCreatePoolResult(result);
    }

    return result;
}

export async function helper_reserve(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    maximumAmountIn: bigint,
    minimumAmountOut: bigint = 0n,
    forLP = false,
    log: boolean = true,
    sendUTXO: boolean = false,
): Promise<ReserveResult> {
    if (log) {
        logAction(`reserve`);
    }

    const backup = Blockchain.txOrigin;
    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.reserve({
        token: tokenAddress,
        maximumAmountIn: maximumAmountIn,
        minimumAmountOut: minimumAmountOut,
        forLP: forLP,
    });

    if (log) {
        logReserveResult(result);
    }

    const decodedReservation = NativeSwapTypesCoders.decodeReservationEvents(
        result.response.events,
    );

    if (log) {
        for (let i = 0; i < decodedReservation.recipients.length; i++) {
            logRecipient(decodedReservation.recipients[i]);
        }
    }

    if (sendUTXO) {
        createRecipientUTXOs(decodedReservation.recipients);
    }

    // Reset
    Blockchain.txOrigin = backup;
    Blockchain.msgSender = backup;

    return result;
}

export async function helper_swap(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    log: boolean = true,
): Promise<SwapResult> {
    if (log) {
        logAction('swap');
    }
    const backup = Blockchain.txOrigin;

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.swap({
        token: tokenAddress,
    });

    if (log) {
        logSwapResult(result);
    }

    const swapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(
        result.response.events[result.response.events.length - 1].data,
    );

    if (log) {
        logSwapExecutedEvent(swapEvent);
    }

    // Reset
    Blockchain.txOrigin = backup;
    Blockchain.msgSender = backup;

    return result;
}

export async function helper_createToken(
    deployer: Address,
    tokenDecimals: number,
    initialMintCount: number,
): Promise<OP_20> {
    // Instantiate and register the OP_20 token
    let token = new OP_20({
        file: 'MyToken',
        deployer: deployer,
        address: Blockchain.generateRandomAddress(),
        decimals: tokenDecimals,
    });

    Blockchain.register(token);
    await token.init();

    // Mint tokens to the user
    await token.mint(deployer, initialMintCount);

    return token;
}

export async function helper_getReserve(
    nativeSwap: NativeSwap,
    token: OP_20,
    log: boolean = true,
): Promise<GetReserveResult> {
    if (log) {
        logAction('getReserve');
    }

    const reserveResult = await nativeSwap.getReserve({
        token: token.address,
    });

    if (log) {
        logGetReserveResult(reserveResult);
    }

    return reserveResult;
}

export async function helper_getQuote(
    nativeSwap: NativeSwap,
    token: OP_20,
    satoshisIn: bigint,
    log: boolean = true,
): Promise<GetQuoteResult> {
    if (log) {
        logAction('getQuote');
    }

    const quoteResult = await nativeSwap.getQuote({
        token: token.address,
        satoshisIn: satoshisIn,
    });

    if (log) {
        logGetQuoteResult(quoteResult);
    }

    return quoteResult;
}
