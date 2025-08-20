import { Address } from '@btc-vision/transaction';
import { Blockchain, OP20 } from '@btc-vision/unit-test-framework';
import {
    logAction,
    logCancelListingEvents,
    logCancelListingResult,
    logCreatePoolResult,
    logGetProviderDetailsResult,
    logGetQuoteResult,
    logGetReserveResult,
    logLiquidityListedEvent,
    logListLiquidityEvent,
    logListLiquidityResult,
    logRecipient,
    logReserveResult,
    logSwapEvents,
    logSwapExecutedEvent,
    logSwapResult,
} from './LoggerHelper.js';
import { NativeSwapTypesCoders } from '../../contracts/NativeSwapTypesCoders.js';
import { createRecipientUTXOs } from './UTXOSimulator.js';
import { NativeSwap } from '../../contracts/NativeSwap.js';
import {
    CancelListingResult,
    CreatePoolResult,
    GetProviderDetailsResult,
    GetQuoteResult,
    GetReserveResult,
    ListLiquidityResult,
    Recipient,
    ReserveResult,
    SwapResult,
} from '../../contracts/NativeSwapTypes.js';

export interface ReserveDataNew {
    provider: Address;
    recipient: Recipient;
}

export async function helper_createPoolNew(
    nativeSwap: NativeSwap,
    token: OP20,
    owner: Address,
    receiver: Address,
    floorPrice: bigint,
    poolInitialLiquidity: bigint,
    maxReservesIn5BlocksPercent: number = 60,
    log: boolean = false,
    mint: boolean = false,
    antiBotEnabledFor: number = 0,
    antiBotMaximumTokensPerReservation: bigint = 0n,
): Promise<CreatePoolResult> {
    if (log) {
        logAction('createPool');
    }
    Blockchain.txOrigin = owner;
    Blockchain.msgSender = owner;

    if (mint) {
        await token.mintRaw(owner, poolInitialLiquidity);
    }

    await token.increaseAllowance(owner, nativeSwap.address, poolInitialLiquidity);

    const result = await nativeSwap.createPool({
        token: token.address,
        floorPrice: floorPrice,
        initialLiquidity: poolInitialLiquidity,
        receiver: receiver,
        antiBotEnabledFor: antiBotEnabledFor,
        antiBotMaximumTokensPerReservation: antiBotMaximumTokensPerReservation,
        maxReservesIn5BlocksPercent: maxReservesIn5BlocksPercent,
        network: Blockchain.network,
    });

    if (log) {
        logCreatePoolResult(result);
        logListLiquidityEvent(result.response.events);
    }

    return result;
}

export async function helper_createTokenNew(
    deployer: Address,
    tokenDecimals: number,
    initialMintCount: bigint,
): Promise<OP20> {
    let token = new OP20({
        file: 'MyToken',
        deployer: deployer,
        address: Blockchain.generateRandomAddress(),
        decimals: tokenDecimals,
    });

    Blockchain.register(token);
    await token.init();
    await token.mintRaw(deployer, initialMintCount);

    return token;
}

export async function helper_listLiquidityNew(
    nativeSwap: NativeSwap,
    token: OP20,
    caller: Address,
    amountIn: bigint,
    priority: boolean,
    providerAddress: Address,
    disablePriorityQueueFees: boolean,
    mint: boolean = true,
    log: boolean = false,
): Promise<ListLiquidityResult> {
    if (log) {
        logAction('listLiquidity');
    }

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    if (mint) {
        await token.mintRaw(caller, amountIn);
        await token.increaseAllowance(caller, nativeSwap.address, amountIn);
    }

    const result = await nativeSwap.listLiquidity({
        token: token.address,
        receiver: providerAddress,
        amountIn: amountIn,
        priority: priority,
        disablePriorityQueueFees: disablePriorityQueueFees,
        network: Blockchain.network,
    });

    if (log) {
        logListLiquidityResult(result);
        logListLiquidityEvent(result.response.events);
    }

    return result;
}

export async function helper_cancelLiquidityNew(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    log: boolean = false,
): Promise<CancelListingResult> {
    if (log) {
        logAction('cancelLiquidity');
    }

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.cancelListing({ token: tokenAddress });

    if (log) {
        logCancelListingResult(result);
        logCancelListingEvents(result.response.events);
    }

    return result;
}

export async function helper_getProviderDetailsNew(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    log: boolean = false,
): Promise<GetProviderDetailsResult> {
    if (log) {
        logAction('getProviderDetails');
    }

    const getResult = await nativeSwap.getProviderDetails({
        token: tokenAddress,
    });

    if (log) {
        logGetProviderDetailsResult(getResult);
    }

    return getResult;
}

export async function helper_getReserveNew(
    nativeSwap: NativeSwap,
    token: OP20,
    log: boolean = false,
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

export async function helper_reserveNew(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    maximumAmountIn: bigint,
    minimumAmountOut: bigint = 0n,
    log: boolean = false,
    activationDelay: number = 2,
    feesAddress: string = '',
): Promise<ReserveResult> {
    if (log) {
        logAction(`reserve`);
    }

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.reserve(
        {
            token: tokenAddress,
            maximumAmountIn: maximumAmountIn,
            minimumAmountOut: minimumAmountOut,
            activationDelay: activationDelay,
        },
        feesAddress,
    );

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

    return result;
}

export async function helper_swapNew(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    log: boolean = false,
): Promise<SwapResult> {
    if (log) {
        logAction('swap');
    }

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.swap({
        token: tokenAddress,
    });

    if (log) {
        logSwapResult(result);
    }

    if (log) {
        logSwapEvents(result.response.events);
    }

    return result;
}

/*



export async function helper_getQuote(
    nativeSwap: NativeSwap,
    token: OP20,
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

*/
