import {
    ABICoder,
    Address,
    AddressMap,
    AddressSet,
    BinaryReader,
    BinaryWriter,
    NetEvent,
} from '@btc-vision/transaction';
import { Logger } from '@btc-vision/logger';
import { BitcoinNetworkRequest } from '@btc-vision/op-vm';
import bitcoin from '@btc-vision/bitcoin';
import crypto from 'crypto';
import { Blockchain } from '../../blockchain/Blockchain.js';
import { DISABLE_REENTRANCY_GUARD, MAX_CALL_STACK_DEPTH } from '../../contracts/configs.js';
import { CallResponse } from '../interfaces/CallResponse.js';
import { ContractDetails } from '../interfaces/ContractDetails.js';
import { ContractParameters, RustContract } from '../vm/RustContract.js';
import { BytecodeManager } from './GetBytecode.js';

// Masks to separate the first 240 bits and the last 80 bits
const first240BitsMask = 0x0000000000ffffffffffffffffffffffffffffffffffffffffffffffffn;
const last80BitsMask = 0xffffffffffffff00000000000000000000000000000000000000000000000000n;

export class ContractRuntime extends Logger {
    public readonly logColor: string = '#39b2f3';

    public gasUsed: bigint = 0n;
    public address: Address;
    public readonly deployer: Address;

    protected states: Map<bigint, bigint> = new Map();
    protected deploymentStates: Map<bigint, bigint> = new Map();

    protected shouldPreserveState: boolean = false;
    protected events: NetEvent[] = [];

    protected readonly gasLimit: bigint = 100_000_000_000n;
    protected readonly deployedContracts: AddressMap<Buffer> = new AddressMap<Buffer>();
    protected readonly abiCoder = new ABICoder();

    private callStack: AddressSet = new AddressSet();
    private statesBackup: Map<bigint, bigint> = new Map();

    private readonly potentialBytecode?: Buffer;
    private readonly deploymentCalldata?: Buffer;

    protected constructor(details: ContractDetails) {
        super();

        this.deployer = details.deployer;
        this.address = details.address;

        this.potentialBytecode = details.bytecode;
        this.deploymentCalldata = details.deploymentCalldata;

        if (details.gasLimit) {
            this.gasLimit = details.gasLimit;
        }

        if (!this.deployer) {
            throw new Error('Deployer address not provided');
        }
    }

    _contract: RustContract | undefined;

    public get contract(): RustContract {
        if (!this._contract) {
            throw new Error('Contract not initialized');
        }

        return this._contract;
    }

    public get safeRnd64(): bigint {
        return Blockchain.blockNumber >> 1n;
    }

    protected _bytecode: Buffer | undefined;

    protected get bytecode(): Buffer {
        if (!this._bytecode) throw new Error(`Bytecode not found for ${this.address}`);

        return this._bytecode;
    }

    private get transactionId(): Uint8Array {
        // generate random 32 bytes
        return crypto.getRandomValues(new Uint8Array(32));
    }

    private get p2trAddress(): string {
        return this.address.p2tr(Blockchain.network);
    }

    public preserveState(): void {
        this.shouldPreserveState = true;
    }

    public getStates(): Map<bigint, bigint> {
        return this.states;
    }

    public getDeploymentStates(): Map<bigint, bigint> {
        return this.deploymentStates;
    }

    public setStates(states: Map<bigint, bigint>): void {
        this.states = new Map(states);
    }

    public delete(): void {
        this.dispose();

        delete this._contract;
        delete this._bytecode;

        this.restoreStatesToDeployment();
        this.statesBackup.clear();

        this.events = [];

        this.callStack.clear();
        this.deployedContracts.clear();
    }

    public resetStates(): Promise<void> | void {
        this.restoreStatesToDeployment();
    }

    public async setEnvironment(
        msgSender: Address = Blockchain.msgSender || this.deployer,
        txOrigin: Address = Blockchain.txOrigin || this.deployer,
        currentBlock: bigint = Blockchain.blockNumber,
        owner: Address = this.deployer,
        address: Address = this.address,
    ): Promise<void> {
        const writer = new BinaryWriter();
        writer.writeAddress(msgSender);
        writer.writeAddress(txOrigin); // "leftmost thing in the call chain"
        writer.writeBytes(this.transactionId); // "transaction id"
        writer.writeU256(currentBlock);
        writer.writeAddress(owner);
        writer.writeAddress(address);
        writer.writeU64(Blockchain.medianTimestamp);
        writer.writeU64(this.safeRnd64); // rnd number for now

        await this.contract.setEnvironment(writer.getBuffer());
    }

    public backupStates(): void {
        this.statesBackup = new Map(this.states);
    }

    public restoreStates(): void {
        this.states = new Map(this.statesBackup);
    }

    public async onCall(
        data: Buffer | Uint8Array,
        sender: Address,
        from: Address,
    ): Promise<CallResponse> {
        const reader = new BinaryReader(data);
        const selector: number = reader.readSelector();

        if (Blockchain.traceCalls) {
            this.log(
                `Called externally by an other contract. Selector: ${selector.toString(16)}`, //- Calldata: ${calldata.toString('hex')}
            );
        }

        const response: CallResponse = await this.execute(data as Buffer, sender, from);
        if (Blockchain.traceCalls) {
            this.log(`Call response: ${response.response}`);
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

            this.gasUsed = this.contract.getUsedGas();
        }
    }

    public async init(): Promise<void> {
        this.defineRequiredBytecodes();

        this._bytecode = BytecodeManager.getBytecode(this.address) as Buffer;

        return Promise.resolve();
    }

    public async deployContract(): Promise<void> {
        if (this.deploymentStates.size || this.states.size) {
            return;
        }

        this.loadContract();

        await this.setEnvironment(this.deployer, this.deployer);

        const calldata = this.deploymentCalldata || Buffer.alloc(0);

        let error: Error | undefined;
        await this.contract.onDeploy(calldata).catch((e: unknown) => {
            error = e as Error;
        });

        if (error) {
            throw this.handleError(error);
        }

        this.deploymentStates = new Map(this.states);

        this.dispose();
    }

    protected async execute(
        calldata: Buffer | Uint8Array,
        sender?: Address,
        txOrigin?: Address,
    ): Promise<CallResponse> {
        // Deploy if not deployed.
        await this.deployContract();

        this.loadContract();

        if (sender || txOrigin) {
            await this.setEnvironment(sender, txOrigin);
        } else {
            await this.setEnvironment();
        }

        const usedGasBefore = this.contract.getUsedGas();
        const statesBackup = new Map(this.states);

        let error: Error | undefined;
        const response = await this.contract.execute(calldata).catch(async (e: unknown) => {
            error = (await e) as Error;

            // Restore states
            this.states = statesBackup;

            return undefined;
        });

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

    protected loadContract(): void {
        try {
            if (!this.shouldPreserveState) {
                this.states = new Map(this.deploymentStates);
            }

            try {
                this.dispose();
            } catch (e) {
                const strErr = (e as Error).message;

                if (strErr.includes('REENTRANCY')) {
                    this.warn(strErr);
                }
            }

            this.events = [];
            this.callStack = new AddressSet([this.address]);

            const params: ContractParameters = this.generateParams();
            this._contract = new RustContract(params);
        } catch (e) {
            if (this._contract) {
                try {
                    this._contract.dispose();
                } catch {}
            }

            throw e;
        }
    }

    private restoreStatesToDeployment(): void {
        this.states = new Map(this.deploymentStates);
    }

    private async deployContractAtAddress(data: Buffer): Promise<Buffer | Uint8Array> {
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
        const newContract: ContractRuntime = new ContractRuntime({
            address: deployResult.contractAddress,
            deployer: this.address,
            gasLimit: this.gasLimit,
            bytecode: requestedContractBytecode,
        });

        newContract.preserveState();

        if (Blockchain.traceDeployments) {
            this.info(
                `Deploying contract at ${deployResult.contractAddress.p2tr(Blockchain.network)} - virtual address 0x${deployResult.virtualAddress.toString('hex')}`,
            );
        }

        Blockchain.register(newContract);

        await newContract.init();

        if (Blockchain.traceDeployments) {
            this.log(
                `Deployed contract at ${deployResult.contractAddress.p2tr(Blockchain.network)}`,
            );
        }

        this.deployedContracts.set(deployResult.contractAddress, this.bytecode);

        const response = new BinaryWriter();
        response.writeBytes(deployResult.virtualAddress);
        response.writeAddress(deployResult.contractAddress);

        return response.getBuffer();
    }

    private load(data: Buffer): Buffer | Uint8Array {
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

    private store(data: Buffer): Buffer | Uint8Array {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        if (Blockchain.tracePointers) {
            this.log(`Attempting to store pointer ${pointer} - value ${value}`);
        }

        this.states.set(pointer, value);

        const response: BinaryWriter = new BinaryWriter();
        response.writeBoolean(true);

        return response.getBuffer();
    }

    private sortBigint(a: bigint, b: bigint): number {
        return Number(a - b);
    }

    private getBestNextPointerValueGreaterThan(
        pointer: bigint,
        lte: boolean,
        valueAtLeast: bigint,
    ): bigint {
        // Masks to separate the token (bits 80-239) and the word position (bits 0-79)
        const tokenMask = ((1n << 160n) - 1n) << 80n; // Bits 80 to 239
        const wordPosMask = (1n << 80n) - 1n; // Bits 0 to 79

        // Extract the token and word position from the pointer
        const pointerToken = (pointer & tokenMask) >> 80n;
        const pointerWordPos = pointer & wordPosMask;

        // Convert keys to an array
        const keys = Array.from(this.states.keys());

        // Filter keys to only those with the same token
        const filteredKeys = keys.filter((key) => {
            const keyToken = (key & tokenMask) >> 80n;
            return keyToken === pointerToken;
        });

        // Sort the filtered keys based on the word position and lte
        if (lte) {
            // Sort in descending order to find the largest key with wordPos <= pointer's wordPos
            filteredKeys.sort((a, b) => this.sortBigint(b & wordPosMask, a & wordPosMask));
        } else {
            // Sort in ascending order to find the smallest key with wordPos > pointer's wordPos
            filteredKeys.sort((a, b) => this.sortBigint(a & wordPosMask, b & wordPosMask));
        }

        // Iterate over the sorted keys
        for (const key of filteredKeys) {
            const keyWordPos = key & wordPosMask;

            // Apply lte condition based on the word position comparison
            if (lte) {
                if (keyWordPos > pointerWordPos) {
                    continue;
                }
            } else {
                if (keyWordPos <= pointerWordPos) {
                    continue;
                }
            }

            // Retrieve the value associated with the key
            const value = this.states.get(key);

            // Check if the value is greater than zero
            if (value !== undefined && value > valueAtLeast) {
                return key;
            }
        }

        return 0n;
    }

    private nextPointerValueGreaterThan(
        pointer: bigint,
        lte: boolean,
        valueAtLeast: bigint,
    ): Buffer | Uint8Array {
        const pointerReturn = this.getBestNextPointerValueGreaterThan(pointer, lte, valueAtLeast);
        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(pointerReturn);

        return response.getBuffer();
    }

    private checkReentrancy(calls: AddressSet): void {
        if (DISABLE_REENTRANCY_GUARD) {
            return;
        }

        if (calls.has(this.address)) {
            throw new Error('OPNET: REENTRANCY DETECTED');
        }
    }

    private async call(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const contractAddress: Address = reader.readAddress();
        const calldata: Uint8Array = reader.readBytesWithLength();

        if (!contractAddress) {
            throw new Error(`No contract address specified in call?`);
        }

        if (Blockchain.traceCalls) {
            this.info(`Attempting to call contract ${contractAddress.p2tr(Blockchain.network)}`);
        }

        const contract: ContractRuntime = Blockchain.getContract(contractAddress);
        const code = contract.bytecode;
        const ca = new ContractRuntime({
            address: contractAddress,
            deployer: contract.deployer,
            bytecode: code,
            gasLimit: contract.gasLimit,
        });

        ca.preserveState();
        ca.setStates(contract.getStates());

        await ca.init();

        const callResponse: CallResponse = await ca.onCall(
            calldata,
            this.address,
            Blockchain.txOrigin,
        );
        contract.setStates(ca.getStates());

        try {
            ca.delete();
        } catch {}

        this.events = [...this.events, ...callResponse.events];
        this.callStack = this.callStack.combine(callResponse.callStack);

        if (this.callStack.size > MAX_CALL_STACK_DEPTH) {
            throw new Error(`OPNET: CALL_STACK DEPTH EXCEEDED`);
        }

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
        switch (Blockchain.network) {
            case bitcoin.networks.bitcoin:
                return BitcoinNetworkRequest.Mainnet;
            case bitcoin.networks.testnet:
                return BitcoinNetworkRequest.Testnet;
            case bitcoin.networks.regtest:
                return BitcoinNetworkRequest.Regtest;
            default:
                throw new Error('Unknown network');
        }
    }

    private onEvent(data: Buffer): void {
        const reader = new BinaryReader(data);
        const eventName = reader.readStringWithLength();
        const eventData = reader.readBytesWithLength();

        const event = new NetEvent(eventName, eventData);
        this.events.push(event);
    }

    private onInputsRequested(): Promise<Buffer> {
        return Promise.resolve(Buffer.alloc(1));
    }

    private onOutputsRequested(): Promise<Buffer> {
        return Promise.resolve(Buffer.alloc(1));
    }

    private generateParams(): ContractParameters {
        return {
            address: this.p2trAddress,
            bytecode: this.bytecode,
            gasLimit: this.gasLimit,
            network: this.getNetwork(),
            gasCallback: this.onGas.bind(this),
            contractManager: Blockchain.contractManager,
            deployContractAtAddress: this.deployContractAtAddress.bind(this),
            load: (data: Buffer) => {
                return new Promise((resolve) => {
                    resolve(this.load(data));
                });
            },
            nextPointerValueGreaterThan: (data: Buffer) => {
                return new Promise((resolve) => {
                    const reader = new BinaryReader(data);
                    const pointer: bigint = reader.readU256();
                    const valueAtLeast: bigint = reader.readU256();
                    const lte: boolean = reader.readBoolean();

                    resolve(this.nextPointerValueGreaterThan(pointer, lte, valueAtLeast));
                });
            },
            store: (data: Buffer) => {
                return new Promise((resolve) => {
                    resolve(this.store(data));
                });
            },
            call: this.call.bind(this),
            log: this.onLog.bind(this),
            emit: this.onEvent.bind(this),
            inputs: this.onInputsRequested.bind(this),
            outputs: this.onOutputsRequested.bind(this),
        };
    }

    private onGas(gas: bigint, method: string): void {
        if (Blockchain.traceGas) {
            this.debug(`Gas: ${gas}`, method);
        }
    }
}
