import { Blockchain } from '@btc-vision/unit-test-framework';
import {
    CreatePoolResult,
    GetQuoteResult,
    GetReserveResult,
    Recipient,
    ReserveResult,
    SwapExecutedEvent,
    SwapResult,
} from '../../contracts/NativeSwapTypes.js';

export function logGetReserveResult(result: GetReserveResult): void {
    Blockchain.log(``);
    Blockchain.log(`GetReserveResult`);
    Blockchain.log(`----------------`);
    Blockchain.log(`liquidity: ${result.liquidity}`);
    Blockchain.log(`reservedLiquidity: ${result.reservedLiquidity}`);
    Blockchain.log(`virtualBTCReserve: ${result.virtualBTCReserve}`);
    Blockchain.log(`virtualTokenReserve: ${result.virtualTokenReserve}`);
    Blockchain.log(``);
}

export function logReserveResult(result: ReserveResult): void {
    Blockchain.log(``);
    Blockchain.log(`ReserveResult`);
    Blockchain.log(`-------------`);
    Blockchain.log(`totalSatoshis: ${result.totalSatoshis}`);
    Blockchain.log(`expectedAmountOut: ${result.expectedAmountOut}`);
    Blockchain.log(``);
}

export function logSwapResult(result: SwapResult): void {
    Blockchain.log(``);
    Blockchain.log(`SwapResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`result: ${result.result}`);
    Blockchain.log(``);
}

export function logCreatePoolResult(result: CreatePoolResult): void {
    Blockchain.log(``);
    Blockchain.log(`CreatePoolResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`result: ${result.result}`);
    Blockchain.log(``);
}

export function logGetQuoteResult(result: GetQuoteResult): void {
    Blockchain.log(``);
    Blockchain.log(`GetQuoteResult`);
    Blockchain.log(`----------`);
    Blockchain.log(`tokensOut: ${result.tokensOut}`);
    Blockchain.log(`price: ${result.price}`);
    Blockchain.log(`requiredSatoshis: ${result.requiredSatoshis}`);
    Blockchain.log(``);
}

export function logSwapExecutedEvent(event: SwapExecutedEvent): void {
    Blockchain.log(``);
    Blockchain.log(`SwapExecutedEvent`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`amountIn: ${event.amountIn}`);
    Blockchain.log(`amountOut: ${event.amountOut}`);
    Blockchain.log(`buyer: ${event.buyer}`);
    Blockchain.log(``);
}

export function logBeginSection(name: string): void {
    Blockchain.log(``);
    Blockchain.log(`###################### Begin ${name} ###########################`);
    Blockchain.log(``);
}

export function logEndSection(name: string): void {
    Blockchain.log(``);
    Blockchain.log(`###################### End ${name} ###########################`);
    Blockchain.log(``);
}

export function logAction(name: string): void {
    Blockchain.log(`>>> Action: ${name} <<<`);
}

export function logRecipient(recipient: Recipient) {
    Blockchain.log(``);
    Blockchain.log(`Recipient`);
    Blockchain.log(`-----------------`);
    Blockchain.log(`address: ${recipient.address}`);
    Blockchain.log(`amount: ${recipient.amount}`);
    Blockchain.log(``);
}
