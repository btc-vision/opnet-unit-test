import { ContractParameters, ExportedContract, loadRust } from '../vm/loader.js';
import {
    ABICoder,
    Address,
    BinaryReader,
    BinaryWriter,
    MethodMap,
    NetEvent,
    Selector,
    SelectorsMap,
} from '@btc-vision/bsi-binary';
import bitcoin from 'bitcoinjs-lib';
import { AddressGenerator } from '@btc-vision/transaction';
import { Logger } from '@btc-vision/logger';
import { BytecodeManager } from './GetBytecode.js';
import { Blockchain } from '../../blockchain/Blockchain.js';
import { BitcoinNetworkRequest } from '@btc-vision/bsi-wasmer-vm';

export interface CallResponse {
    response?: Uint8Array;
    error?: Error;
    events: NetEvent[];
    callStack: Address[];

    usedGas: bigint;
}

export class ContractRuntime extends Logger {
    public readonly logColor: string = '#39b2f3';

    protected states: Map<bigint, bigint> = new Map();

    protected shouldPreserveState: boolean = false;
    protected events: NetEvent[] = [];

    protected readonly deployedContracts: Map<string, Buffer> = new Map();
    protected readonly abiCoder = new ABICoder();
    private callStack: Address[] = [];

    private statesBackup: Map<bigint, bigint> = new Map();
    private network: bitcoin.Network = Blockchain.network;

    protected constructor(
        public address: string,
        public readonly deployer: string,
        protected readonly gasLimit: bigint = 300_000_000_000n,
        private readonly potentialBytecode?: Buffer,
    ) {
        super();
    }

    _contract: ExportedContract | undefined;

    public get contract(): ExportedContract {
        if (!this._contract) {
            throw new Error('Contract not initialized');
        }

        return this._contract;
    }

    private _viewAbi: SelectorsMap | undefined;

    public get viewAbi(): SelectorsMap {
        if (!this._viewAbi) {
            throw new Error('View ABI not found');
        }

        return this._viewAbi;
    }

    private _writeMethods: MethodMap | undefined;

    public get writeMethods(): MethodMap {
        if (!this._writeMethods) {
            throw new Error('Write methods not found');
        }

        return this._writeMethods;
    }

    protected _bytecode: Buffer | undefined;

    protected get bytecode(): Buffer {
        if (!this._bytecode) throw new Error(`Bytecode not found`);

        return this._bytecode;
    }

    public preserveState(): void {
        this.shouldPreserveState = true;
    }

    public getStates(): Map<bigint, bigint> {
        return this.states;
    }

    public delete(): void {
        this.dispose();

        delete this._contract;
    }

    public async resetStates(): Promise<void> {
        this.states.clear();
    }

    public async getViewAbi(): Promise<void> {
        const abi = await this.contract.getViewABI();
        const reader = new BinaryReader(abi);

        this._viewAbi = reader.readViewSelectorsMap();

        return;
    }

    public async getWriteMethods(): Promise<void> {
        const abi = await this.contract.getWriteMethods();
        const reader = new BinaryReader(abi);

        this._writeMethods = reader.readMethodSelectorsMap();

        return;
    }

    public async setEnvironment(
        caller: Address = Blockchain.caller || this.deployer,
        callee: Address = Blockchain.callee || this.deployer,
        currentBlock: bigint = Blockchain.blockNumber,
        owner: Address = this.deployer,
        address: Address = this.address,
    ): Promise<void> {
        const writer = new BinaryWriter();
        writer.writeAddress(caller);
        writer.writeAddress(callee);
        writer.writeU256(currentBlock);
        writer.writeAddress(owner);
        writer.writeAddress(address);
        writer.writeU64(BigInt(Date.now()));

        await this.contract.setEnvironment(writer.getBuffer());
    }

    public async getEvents(): Promise<NetEvent[]> {
        const events = await this.contract.getEvents();
        const reader = new BinaryReader(events);

        return reader.readEvents();
    }

    public backupStates(): void {
        this.statesBackup = new Map(this.states);
    }

    public restoreStates(): void {
        this.states.clear();
        this.states = new Map(this.statesBackup);
    }

    public isReadonlyMethod(selector: Selector): boolean {
        for (const [_, value] of this.viewAbi) {
            if (value === selector) {
                return true;
            }
        }

        return false;
    }

    public async onCall(
        data: Buffer | Uint8Array,
        caller: Address,
        callee: Address,
    ): Promise<CallResponse> {
        const reader = new BinaryReader(data);
        const selector: number = reader.readSelector();
        const calldata: Buffer = data.subarray(4) as Buffer;

        if (Blockchain.traceCalls) {
            this.log(
                `Called externally by an other contract. Selector: ${selector.toString(16)}`, //- Calldata: ${calldata.toString('hex')}
            );
        }

        let response: CallResponse;
        if (calldata.length === 0) {
            response = await this.readView(selector, caller, callee);
        } else {
            response = await this.readMethod(selector, calldata, caller, callee);
        }

        this.dispose();

        if (response.error) {
            throw this.handleError(response.error);
        }

        const writer = new BinaryWriter();
        writer.writeU64(response.usedGas);

        if (response.response) {
            writer.writeBytes(response.response);
        }

        const newResponse = writer.getBuffer();

        return {
            response: newResponse,
            events: response.events,
            callStack: this.callStack,
            usedGas: response.usedGas,
        };
    }

    public dispose(): void {
        if (this._contract) {
            this._contract.dispose();
        }
    }

    public async init(): Promise<void> {
        this.defineRequiredBytecodes();

        this._bytecode = BytecodeManager.getBytecode(this.address) as Buffer;

        await this.loadContract();
    }

    protected async readMethod(
        selector: number,
        calldata: Buffer,
        caller?: Address,
        callee?: Address,
    ): Promise<CallResponse> {
        await this.loadContract();

        const usedGasBefore = this.contract.getUsedGas();
        if (!!caller) {
            await this.setEnvironment(caller, callee);
        }

        const statesBackup = new Map(this.states);

        let error: Error | undefined;
        const response = await this.contract
            .readMethod(selector, calldata)
            .catch(async (e: unknown) => {
                this.contract.dispose();

                error = (await e) as Error;

                // Restore states
                this.states.clear();
                this.states = statesBackup;

                return undefined;
            });

        const events = await this.getEvents();
        this.events = [...this.events, ...events];

        const usedGas = this.contract.getUsedGas() - usedGasBefore;

        return {
            response,
            error,
            events: this.events,
            callStack: this.callStack,
            usedGas: usedGas,
        };
    }

    protected async readView(
        selector: number,
        caller?: Address,
        callee?: Address,
    ): Promise<CallResponse> {
        await this.loadContract();

        const usedGasBefore = this.contract.getUsedGas();
        if (caller) {
            await this.setEnvironment(caller, callee);
        }

        const statesBackup = new Map(this.states);

        let error: Error | undefined;
        const response = await this.contract.readView(selector).catch(async (e: unknown) => {
            this.contract.dispose();

            error = (await e) as Error;

            // Restore states
            this.states.clear();
            this.states = statesBackup;

            return undefined;
        });

        if (this.hasModifiedStates(this.states, statesBackup)) {
            throw new Error('OPNET: READONLY_MODIFIED_STATES');
        }

        const events = await this.getEvents();
        this.events = [...this.events, ...events];

        const usedGas = this.contract.getUsedGas() - usedGasBefore;

        return {
            response,
            error,
            events: this.events,
            callStack: this.callStack,
            usedGas: usedGas,
        };
    }

    protected handleError(error: Error): Error {
        return new Error(`(in: ${this.address}) OPNET: ${error.stack}`);
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
        if (!this.shouldPreserveState) {
            this.states.clear();
        }

        this.events = [];
        this.callStack = [this.address];

        this.dispose();

        let params: ContractParameters = this.generateParams();
        this._contract = await loadRust(params);

        await this.setEnvironment();

        if (!this._viewAbi) {
            await this.contract.defineSelectors();
            await this.getViewAbi();
            await this.getWriteMethods();
        }
    }

    private hasModifiedStates(
        states: Map<bigint, bigint>,
        statesBackup: Map<bigint, bigint>,
    ): boolean {
        if (states.size !== statesBackup.size) {
            return true;
        }

        for (const [key, value] of states) {
            if (statesBackup.get(key) !== value) {
                return true;
            }
        }

        for (const [key, value] of statesBackup) {
            if (states.get(key) !== value) {
                return true;
            }
        }

        return false;
    }

    private async deployContractAtAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        return new Promise(async (resolve, _reject) => {
            const reader = new BinaryReader(data);

            const address: Address = reader.readAddress();
            const salt: Buffer = Buffer.from(reader.readBytes(32)); //Buffer.from(`${reader.readU256().toString(16)}`, 'hex');
            const saltBig = BigInt(
                '0x' + salt.reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), ''),
            );

            if (Blockchain.traceDeployments) {
                this.log(
                    `This contract wants to deploy the same bytecode as ${address}. Salt: ${salt.toString('hex')} or ${saltBig}`,
                );
            }

            const deployResult = Blockchain.generateAddress(this.address, salt, address);
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

            newContract.preserveState();

            if (Blockchain.traceDeployments) {
                this.info(
                    `Deploying contract at ${deployResult.contractAddress.toString()} - virtual address 0x${deployResult.virtualAddress.toString('hex')}`,
                );
            }

            Blockchain.register(newContract);

            await newContract.init();

            if (Blockchain.traceDeployments) {
                this.log(`Deployed contract at ${deployResult.contractAddress.toString()}`);
            }

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

        if (Blockchain.tracePointers) {
            this.log(`Attempting to load pointer ${pointer} - value ${value}`);
        }

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(value);

        return response.getBuffer();
    }

    private async encodeAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const virtualAddress = reader.readBytesWithLength();
        const buf = Buffer.from(virtualAddress);
        const address: Address = AddressGenerator.generatePKSH(buf, this.network);

        if (Blockchain.traceCalls) {
            this.info(
                `Generated address: ${address} - from 0x${Buffer.from(virtualAddress).toString('hex')}`,
            );
        }

        const response = new BinaryWriter();
        response.writeAddress(address);

        return response.getBuffer();
    }

    private async store(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        if (Blockchain.tracePointers) {
            this.log(`Attempting to store pointer ${pointer} - value ${value}`);
        }

        this.states.set(pointer, value);

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(0n);

        return response.getBuffer();
    }

    private checkReentrancy(calls: Address[]): void {
        /*if (this.callStack.length !== new Set(this.callStack).size) {
            console.log(this.callStack);

            throw new Error(`OPNET: REENTRANCY DETECTED`);
        }*/

        if (calls.includes(this.address)) {
            throw new Error('OPNET: REENTRANCY DETECTED');
        }
    }

    private canWrite(selector: Selector): boolean {
        for (const value of this.writeMethods) {
            if (value === selector) {
                return true;
            }
        }

        return false;
    }

    private async call(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const contractAddress: Address = reader.readAddress();
        const calldata: Uint8Array = reader.readBytesWithLength();

        if (!contractAddress) {
            throw new Error(`No contract address specified in call?`);
        }

        if (Blockchain.traceCalls) {
            this.info(`Attempting to call contract ${contractAddress}`);
        }

        const contract: ContractRuntime = Blockchain.getContract(contractAddress);
        const callResponse = await contract.onCall(calldata, Blockchain.caller, this.address);

        this.events = [...this.events, ...callResponse.events];
        this.callStack = [...this.callStack, ...callResponse.callStack];

        this.checkReentrancy(callResponse.callStack);

        if (!callResponse.response) {
            throw this.handleError(new Error(`OPNET: CALL_FAILED: ${callResponse.error}`));
        }

        return callResponse.response;
    }

    private onLog(data: Buffer | Uint8Array): void {
        const reader = new BinaryReader(data);
        const logData = reader.readStringWithLength();

        this.warn(`Contract log: ${logData}`);
    }

    private getNetwork(): BitcoinNetworkRequest {
        return BitcoinNetworkRequest.Testnet;
    }

    private generateParams(): ContractParameters {
        return {
            bytecode: this.bytecode,
            gasLimit: this.gasLimit,
            network: this.getNetwork(),
            gasCallback: this.onGas.bind(this),
            deployContractAtAddress: this.deployContractAtAddress.bind(this),
            load: this.load.bind(this),
            store: this.store.bind(this),
            call: this.call.bind(this),
            log: this.onLog.bind(this),
            //encodeAddress: this.encodeAddress.bind(this),
        };
    }

    private onGas(gas: bigint, method: string): void {
        if (Blockchain.traceGas) {
            this.debug('Gas:', gas, method);
        }
    }
}
