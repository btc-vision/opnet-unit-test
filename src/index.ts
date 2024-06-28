import fs from 'fs';
// @ts-ignore
import { ContractParameters, ExportedContract, loadRust } from './loader.js';
import { ABICoder, Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import bitcoin from 'bitcoinjs-lib';
import { AddressGenerator, TapscriptVerificator } from '@btc-vision/transaction';
import { Logger } from '@btc-vision/logger';

// init();

const bytecode = fs.readFileSync('./bytecode/factory.wasm');
const abiCoder = new ABICoder();

class ContractRuntime extends Logger {
    #contract: ExportedContract | undefined;

    public readonly logColor: string = '#f3a239';

    private readonly deployer: string =
        'bcrt1pqdekymf30t583r8r9q95jyrgvyxcgrprajmyc9q8twae7ec275kq85vsev';
    private readonly address: string = 'bcrt1qu3gfcxncadq0wt3hz5l28yr86ecf2f0eema3em';

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
        const result = await this.readMethod(selector, Buffer.from(buf));

        const reader: BinaryReader = new BinaryReader(result.response);
        const virtualAddress: bigint = reader.readU256();
        const pairAddress: Address = reader.readAddress();

        this.log(
            `Pair created at ${pairAddress}. Virtual address: 0x${virtualAddress.toString(16)}`,
        );
    }

    private internalPubKeyToXOnly(): Buffer {
        return Buffer.from(this.address, 'utf-8');
    }

    private generateAddress(salt: Buffer): { contractAddress: Address; virtualAddress: Buffer } {
        const contractVirtualAddress = TapscriptVerificator.getContractSeed(
            bitcoin.crypto.hash256(this.internalPubKeyToXOnly()),
            this.bytecode,
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

    private async deployContractAtAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        return new Promise((resolve, _reject) => {
            const reader = new BinaryReader(data);

            const address: Address = reader.readAddress();
            const salt: Buffer = Buffer.from(reader.readBytes(32));

            this.log(
                `This contract wants to deploy the same bytecode as ${address}. Salt: ${salt.toString('hex')}`,
            );

            const deployResult = this.generateAddress(salt);

            const response = new BinaryWriter();
            response.writeBytes(deployResult.virtualAddress);
            response.writeAddress(deployResult.contractAddress);

            //setTimeout(() => {
            resolve(response.getBuffer());
            //}, 1000);
        });
    }

    public async load(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer = reader.readU256();

        this.log(`Attempting to load pointer ${pointer}`);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(0n);

        return response.getBuffer();
    }

    public async store(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        this.log(`Attempting to store pointer ${pointer} - value ${value}`);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(0n);

        return response.getBuffer();
    }

    private generateParams(): ContractParameters {
        return {
            bytecode: this.bytecode,
            gasLimit: this.gasLimit,
            gasCallback: this.onGas.bind(this),
            deployContractAtAddress: this.deployContractAtAddress.bind(this),
            load: this.load.bind(this),
            store: this.store.bind(this),
        };
    }

    private async init(): Promise<void> {
        this.log('Start');
        let now = Date.now();

        let params: ContractParameters = this.generateParams();
        this.#contract = await loadRust(params);

        await this.setEnvironment();
        await this.createPair();

        this.contract.dispose();
        this.log('Time:', Date.now() - now, 'ms');
    }

    private onGas(gas: bigint, method: string): void {
        this.debug('Gas:', gas, method);
    }
}

new ContractRuntime(bytecode);
