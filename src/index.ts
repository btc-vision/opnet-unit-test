import fs from 'fs';
// @ts-ignore
import { ContractParameters, ExportedContract, loadRust } from './loader.js';
import { ABICoder, Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import bitcoin, { crypto as bitCrypto } from 'bitcoinjs-lib';
import { AddressGenerator, TapscriptVerificator } from '@btc-vision/transaction';
import { Logger } from '@btc-vision/logger';

// init();

const bytecode = fs.readFileSync('./bytecode/factory.wasm');
const pool = fs.readFileSync('./bytecode/pool.wasm');
const abiCoder = new ABICoder();

const poolBytecodeHash = bitCrypto.hash256(pool);
console.log('Pool bytecode hash:', poolBytecodeHash.toString('hex'), Array.from(poolBytecodeHash));

class ContractRuntime extends Logger {
    #contract: ExportedContract | undefined;

    public readonly logColor: string = '#f3a239';

    private readonly deployer: string =
        'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn';

    private readonly address: string = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';

    private readonly states: Map<bigint, bigint> = new Map();

    constructor(
        private readonly bytecode: Buffer,
        private readonly gasLimit: bigint = 300_000_000_000n,
    ) {
        super();

        void this.init();
    }

    public get contract(): any {
        if (!this.#contract) {
            throw new Error('Contract not initialized');
        }

        return this.#contract;
    }

    private async setEnvironment(): Promise<void> {
        const writer = new BinaryWriter();
        writer.writeAddress(this.deployer);
        writer.writeAddress(this.deployer);
        writer.writeU256(0n);
        writer.writeAddress(this.deployer);
        writer.writeAddress(this.address);
        writer.writeU64(BigInt(Date.now()));

        await this.contract.setEnvironment(writer.getBuffer());
    }

    private async createPair(): Promise<void> {
        const selector = Number(`0x${abiCoder.encodeSelector('createPool')}`);

        const calldata = new BinaryWriter();
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn2r'); // token a
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn32'); // token b

        const buf = calldata.getBuffer();

        //console.log(Buffer.from(buf).toString('hex'), abiCoder.encodeSelector('createPool'));

        const result = await this.readMethod(selector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        const virtualAddress: bigint = reader.readU256();
        const pairAddress: Address = reader.readAddress();

        this.log(
            `Pair created at ${pairAddress}. Virtual address: 0x${virtualAddress.toString(16)} or ${virtualAddress}`,
        );
    }

    private async initializePool(): Promise<void> {
        const selector = Number(`0x${abiCoder.encodeSelector('initialize')}`);

        const calldata = new BinaryWriter();
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn2r'); // token a
        calldata.writeAddress('bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn32'); // token b

        const buf = calldata.getBuffer();
        console.log(
            'initialize',
            abiCoder.encodeSelector('initialize'),
            Buffer.from(buf).toString('hex'),
        );

        const result = await this.readMethod(selector, Buffer.from(buf));

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        console.log('response', response);
    }

    private async getToken0(): Promise<void> {
        const selector = Number(`0x${abiCoder.encodeSelector('token0')}`);

        console.log('token0 selector', abiCoder.encodeSelector('token0'));
        const result = await this.readView(selector);

        let response = result.response;
        if (!response) {
            throw result.error;
        }

        const reader: BinaryReader = new BinaryReader(result.response);
        const token0: Address = reader.readAddress();

        this.info(`Token0: ${token0}`);
    }

    private generateAddress(salt: Buffer): { contractAddress: Address; virtualAddress: Buffer } {
        const contractVirtualAddress = TapscriptVerificator.getContractSeed(
            bitcoin.crypto.hash256(Buffer.from(this.address, 'utf-8')),
            pool,
            salt,
        );

        /** Generate contract segwit address */
        const contractSegwitAddress = AddressGenerator.generatePKSH(
            contractVirtualAddress,
            bitcoin.networks.regtest,
        );

        return { contractAddress: contractSegwitAddress, virtualAddress: contractVirtualAddress };
    }

    private async readMethod(
        selector: number,
        calldata: Buffer,
    ): Promise<{ response: Uint8Array; error?: Error }> {
        let error: Error | undefined;
        const response = await this.contract
            .readMethod(selector, calldata)
            .catch(async (e: unknown) => {
                this.contract.dispose();

                error = (await e) as Error;
            });

        return { response, error };
    }

    private async readView(selector: number): Promise<{ response: Uint8Array; error?: Error }> {
        let error: Error | undefined;
        const response = await this.contract.readView(selector).catch(async (e: unknown) => {
            this.contract.dispose();

            error = (await e) as Error;
        });

        return { response, error };
    }

    private async deployContractAtAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        return new Promise((resolve, _reject) => {
            const reader = new BinaryReader(data);

            const address: Address = reader.readAddress();
            const salt: Buffer = Buffer.from(reader.readBytes(32)); //Buffer.from(`${reader.readU256().toString(16)}`, 'hex');
            const saltBig = BigInt(
                '0x' + salt.reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), ''),
            );

            this.log(
                `This contract wants to deploy the same bytecode as ${address}. Salt: ${salt.toString('hex')} or ${saltBig}`,
            );

            const deployResult = this.generateAddress(salt);
            const response = new BinaryWriter();
            response.writeBytes(deployResult.virtualAddress);
            response.writeAddress(deployResult.contractAddress);

            resolve(response.getBuffer());
        });
    }

    public async load(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer = reader.readU256();

        const value = this.states.get(pointer) || 0n;

        this.log(`Attempting to load pointer ${pointer} - value ${value}`);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(value);

        return response.getBuffer();
    }

    public async store(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        this.log(`Attempting to store pointer ${pointer} - value ${value}`);

        this.states.set(pointer, value);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(0n);

        return response.getBuffer();
    }

    public async call(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);

        throw new Error('Not implemented');
    }

    private generateParams(): ContractParameters {
        return {
            bytecode: this.bytecode,
            gasLimit: this.gasLimit,
            gasCallback: this.onGas.bind(this),
            deployContractAtAddress: this.deployContractAtAddress.bind(this),
            load: this.load.bind(this),
            store: this.store.bind(this),
            call: this.call.bind(this),
        };
    }

    private async init(): Promise<void> {
        let now = Date.now();

        let params: ContractParameters = this.generateParams();
        this.#contract = await loadRust(params);

        await this.setEnvironment();
        await this.initializePool();

        this.log('Time:', Date.now() - now, 'ms');
        this.contract.dispose();

        await this.secondCall();
    }

    private async secondCall(): Promise<void> {
        let now = Date.now();

        let params: ContractParameters = this.generateParams();
        this.#contract = await loadRust(params);

        await this.setEnvironment();
        await this.getToken0();

        this.log('Time:', Date.now() - now, 'ms');
        this.contract.dispose();
    }

    private onGas(gas: bigint, method: string): void {
        this.debug('Gas:', gas, method);
    }
}

new ContractRuntime(pool);
