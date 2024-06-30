import { ContractParameters, ExportedContract, loadRust } from '../vm/loader.js';
import { ABICoder, Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import bitcoin from 'bitcoinjs-lib';
import { AddressGenerator, TapscriptVerificator } from '@btc-vision/transaction';
import { Logger } from '@btc-vision/logger';
import { BytecodeManager } from './GetBytecode.js';
import { Blockchain } from '../../blockchain/Blockchain.js';

export class ContractRuntime extends Logger {
    #contract: ExportedContract | undefined;

    public readonly logColor: string = '#39b2f3';

    protected readonly states: Map<bigint, bigint> = new Map();

    protected readonly deployedContracts: Map<string, Buffer> = new Map();

    protected readonly abiCoder = new ABICoder();
    protected _bytecode: Buffer | undefined;

    protected constructor(
        public readonly address: string,
        public readonly deployer: string,
        protected readonly gasLimit: bigint = 300_000_000_000n,
        private readonly potentialBytecode?: Buffer,
    ) {
        super();
    }

    protected get bytecode(): Buffer {
        if (!this._bytecode) throw new Error(`Bytecode not found`);

        return this._bytecode;
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

    private generateAddress(
        salt: Buffer,
        from: Address,
    ): { contractAddress: Address; virtualAddress: Buffer } {
        const bytecode = BytecodeManager.getBytecode(from);
        const contractVirtualAddress = TapscriptVerificator.getContractSeed(
            bitcoin.crypto.hash256(Buffer.from(this.address, 'utf-8')),
            Buffer.from(bytecode),
            salt,
        );

        /** Generate contract segwit address */
        const contractSegwitAddress = AddressGenerator.generatePKSH(
            contractVirtualAddress,
            bitcoin.networks.regtest,
        );

        return { contractAddress: contractSegwitAddress, virtualAddress: contractVirtualAddress };
    }

    protected async readMethod(
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

    protected async readView(selector: number): Promise<{ response: Uint8Array; error?: Error }> {
        let error: Error | undefined;
        const response = await this.contract.readView(selector).catch(async (e: unknown) => {
            this.contract.dispose();

            error = (await e) as Error;
        });

        return { response, error };
    }

    private async deployContractAtAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        return new Promise(async (resolve, _reject) => {
            const reader = new BinaryReader(data);

            const address: Address = reader.readAddress();
            const salt: Buffer = Buffer.from(reader.readBytes(32)); //Buffer.from(`${reader.readU256().toString(16)}`, 'hex');
            const saltBig = BigInt(
                '0x' + salt.reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), ''),
            );

            this.log(
                `This contract wants to deploy the same bytecode as ${address}. Salt: ${salt.toString('hex')} or ${saltBig}`,
            );

            const deployResult = this.generateAddress(salt, address);
            if (this.deployedContracts.has(deployResult.contractAddress)) {
                throw new Error('Contract already deployed');
            }

            if (address === this.address) {
                throw new Error('Cannot deploy the same contract');
            }

            const requestedContractBytecode = BytecodeManager.getBytecode(address) as Buffer;
            const newContract: ContractRuntime = new ContractRuntime(
                deployResult.contractAddress,
                this.address,
                this.gasLimit,
                requestedContractBytecode,
            );

            Blockchain.register(newContract);

            await newContract.init();

            this.log(`Deployed contract at ${deployResult.contractAddress.toString()}`);

            this.deployedContracts.set(deployResult.contractAddress, this.bytecode);

            const response = new BinaryWriter();
            response.writeBytes(deployResult.virtualAddress);
            response.writeAddress(deployResult.contractAddress);

            resolve(response.getBuffer());
        });
    }

    private async load(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer = reader.readU256();

        const value = this.states.get(pointer) || 0n;

        this.log(`Attempting to load pointer ${pointer} - value ${value}`);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(value);

        return response.getBuffer();
    }

    private async store(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        this.log(`Attempting to store pointer ${pointer} - value ${value}`);

        this.states.set(pointer, value);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(0n);

        return response.getBuffer();
    }

    private async call(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const contractAddress: Address = reader.readAddress();
        const calldata: Uint8Array = reader.readBytesWithLength();

        this.info(`Attempting to call contract ${contractAddress}`);

        const contract: ContractRuntime = Blockchain.getContract(contractAddress);

        return await contract.onCall(calldata);
    }

    public async onCall(data: Buffer | Uint8Array): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const selector: number = reader.readSelector();
        const calldata: Buffer = data.subarray(4) as Buffer;

        this.log(
            `Called externally by an other contract. Selector: ${selector.toString(16)} - Calldata: ${calldata.toString('hex')}`,
        );

        await this.loadContract();

        let response: { response: Uint8Array; error?: Error };
        if (calldata.length === 0) {
            response = await this.readView(selector);
        } else {
            response = await this.readMethod(selector, calldata);
        }

        this.dispose();

        if (response.error) {
            throw response.error;
        }

        return response.response;
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

    public dispose(): void {
        if (this.#contract) {
            this.#contract.dispose();
        }
    }

    protected defineRequiredBytecodes(): void {
        if (this.potentialBytecode) {
            this._bytecode = this.potentialBytecode;

            BytecodeManager.setBytecode(this.address, this.potentialBytecode);
        } else {
            throw new Error('Not implemented');
        }
    }

    protected async loadContract(): Promise<void> {
        this.states.clear();
        this.dispose();

        let params: ContractParameters = this.generateParams();
        this.#contract = await loadRust(params);

        await this.setEnvironment();
    }

    private onGas(gas: bigint, method: string): void {
        if (Blockchain.traceGas) {
            this.debug('Gas:', gas, method);
        }
    }

    public async init(): Promise<void> {
        this.defineRequiredBytecodes();

        this._bytecode = BytecodeManager.getBytecode(this.address) as Buffer;

        await this.loadContract();
    }
}
