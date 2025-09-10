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
    logListLiquidityEvent,
    logListLiquidityResult,
    logRecipient,
    logReserveResult,
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

export interface ReserveData {
    provider: Address;
    recipient: Recipient;
}

export async function helper_createPool(
    nativeSwap: NativeSwap,
    token: OP20,
    owner: Address,
    receiver: Address,
    tokenLiquidityToApprove: number,
    floorPrice: bigint,
    poolInitialLiquidity: bigint,
    maxReservesIn5BlocksPercent: number = 60,
    log: boolean = true,
    mint: boolean = false,
    antiBotEnabledFor: number = 0,
    antiBotMaximumTokensPerReservation: bigint = 0n,
): Promise<CreatePoolResult> {
    if (log) {
        logAction('createPool');
    }

    Blockchain.txOrigin = nativeSwap.deployer;
    Blockchain.msgSender = nativeSwap.deployer;

    await nativeSwap.setStakingContractAddress({
        stakingContractAddress: Blockchain.generateRandomAddress(),
    });

    const liquidityAmount: bigint = Blockchain.expandToDecimal(
        tokenLiquidityToApprove,
        token.decimals,
    );

    Blockchain.txOrigin = owner;
    Blockchain.msgSender = owner;

    if (mint) {
        await token.mintRaw(owner, liquidityAmount);
    }

    await token.increaseAllowance(owner, nativeSwap.address, liquidityAmount);

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
    activationDelay: number = 2,
    feesAddress: string = '',
): Promise<ReserveResult> {
    if (log) {
        logAction(`reserve`);
    }

    const backup = Blockchain.txOrigin;
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

    const swapEvt = result.response.events.find((event) => event.type === 'SwapExecuted');
    if (swapEvt) {
        const swapEvent = NativeSwapTypesCoders.decodeSwapExecutedEvent(swapEvt.data);

        if (log) {
            logSwapExecutedEvent(swapEvent);
        }
    }

    // Reset
    Blockchain.txOrigin = backup;
    Blockchain.msgSender = backup;

    return result;
}

export async function helper_cancelLiquidity(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    log: boolean = true,
): Promise<CancelListingResult> {
    if (log) {
        logAction('cancelLiquidity');
    }
    const backup = Blockchain.txOrigin;

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.cancelListing({ token: tokenAddress });

    if (log) {
        logCancelListingResult(result);
        logCancelListingEvents(result.response.events);
    }

    // Reset
    Blockchain.txOrigin = backup;
    Blockchain.msgSender = backup;

    return result;
}

export async function helper_listLiquidity(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    caller: Address,
    amountIn: bigint,
    priority: boolean,
    providerAddress: Address,
    disablePriorityQueueFees: boolean,
    log: boolean = true,
): Promise<ListLiquidityResult> {
    if (log) {
        logAction('listLiquidity');
    }
    const backup = Blockchain.txOrigin;

    Blockchain.txOrigin = caller;
    Blockchain.msgSender = caller;

    const result = await nativeSwap.listLiquidity({
        token: tokenAddress,
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

    // Reset
    Blockchain.txOrigin = backup;
    Blockchain.msgSender = backup;

    return result;
}

export async function helper_createToken(
    deployer: Address,
    tokenDecimals: number,
    initialMintCount: number,
): Promise<OP20> {
    // Instantiate and register the OP_20 token
    let token = new OP20({
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
    token: OP20,
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

export async function helper_getProviderDetails(
    nativeSwap: NativeSwap,
    tokenAddress: Address,
    log: boolean = true,
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

export async function helper_getProviderDetailsById(
    nativeSwap: NativeSwap,
    providerId: bigint,
    log: boolean = true,
): Promise<GetProviderDetailsResult> {
    if (log) {
        logAction('getProviderDetailsById');
    }

    const getResult = await nativeSwap.getProviderDetailsById({
        providerId: providerId,
    });

    if (log) {
        logGetProviderDetailsResult(getResult);
    }

    return getResult;
}

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

export async function helper_getBalance(
    token: OP20,
    stakingContractAddress: Address,
): Promise<bigint> {
    return await token.balanceOf(stakingContractAddress);
}
