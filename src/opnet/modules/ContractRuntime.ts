import { ABICoder, Address, BinaryReader, BinaryWriter, NetEvent } from '@btc-vision/bsi-binary';
import bitcoin from 'bitcoinjs-lib';
import { Logger } from '@btc-vision/logger';
import { BytecodeManager } from './GetBytecode.js';
import { Blockchain } from '../../blockchain/Blockchain.js';
import { BitcoinNetworkRequest } from '@btc-vision/op-vm';
import { ContractParameters, RustContract } from '../vm/RustContract.js';
import { DISABLE_REENTRANCY_GUARD } from '../../contracts/configs.js';

export interface CallResponse {
    response?: Uint8Array;
    error?: Error;
    events: NetEvent[];
    callStack: Address[];

    usedGas: bigint;
}

export class ContractRuntime extends Logger {
    public readonly logColor: string = '#39b2f3';
    public gasUsed: bigint = 0n;

    protected states: Map<bigint, bigint> = new Map();
    protected deploymentStates: Map<bigint, bigint> = new Map();

    protected shouldPreserveState: boolean = false;
    protected events: NetEvent[] = [];

    protected readonly deployedContracts: Map<string, Buffer> = new Map();
    protected readonly abiCoder = new ABICoder();

    private callStack: Address[] = [];
    private statesBackup: Map<bigint, bigint> = new Map();

    protected constructor(
        public address: Address,
        public readonly deployer: Address,
        protected readonly gasLimit: bigint = 100_000_000_000n,
        private readonly potentialBytecode?: Buffer,
    ) {
        super();
    }

    private _deploymentCalldata: Buffer | undefined;

    public set deploymentCalldata(calldata: Buffer) {
        this._deploymentCalldata = calldata;
    }

    _contract: RustContract | undefined;

    public get contract(): RustContract {
        if (!this._contract) {
            throw new Error('Contract not initialized');
        }

        return this._contract;
    }

    public get safeRnd64(): bigint {
        return Blockchain.blockNumber >> 1n; //BigInt(crypto.getRandomValues(new Uint32Array(2)).join(''));
    }

    protected _bytecode: Buffer | undefined;

    protected get bytecode(): Buffer {
        if (!this._bytecode) throw new Error(`Bytecode not found`);

        return this._bytecode;
    }

    private get transactionId(): Uint8Array {
        // generate random 32 bytes
        return crypto.getRandomValues(new Uint8Array(32));
    }

    public preserveState(): void {
        this.shouldPreserveState = true;
    }

    public getStates(): Map<bigint, bigint> {
        return this.states;
    }

    public setStates(states: Map<bigint, bigint>): void {
        this.states = new Map(states);
    }

    public delete(): void {
        this.dispose();

        delete this._contract;
        delete this._bytecode;

        this.states.clear();
        this.statesBackup.clear();
        this.events = [];
        this.callStack = [];
        this.deployedContracts.clear();
    }

    public resetStates(): Promise<void> | void {
        this.states.clear();
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
        this.states.clear();
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

    public init(): void {
        this.defineRequiredBytecodes();

        this._bytecode = BytecodeManager.getBytecode(this.address) as Buffer;
    }

    protected async execute(
        calldata: Buffer | Uint8Array,
        sender?: Address,
        txOrigin?: Address,
    ): Promise<CallResponse> {
        await this.loadContract();

        const usedGasBefore = this.contract.getUsedGas();
        if (sender) {
            await this.setEnvironment(sender, txOrigin);
        }

        const statesBackup = new Map(this.states);

        let error: Error | undefined;
        const response = await this.contract.execute(calldata).catch(async (e: unknown) => {
            error = (await e) as Error;

            // Restore states
            this.states.clear();
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

    protected async loadContract(): Promise<void> {
        try {
            if (!this.shouldPreserveState) {
                this.states.clear();
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
            this.callStack = [this.address];

            const params: ContractParameters = this.generateParams();
            this._contract = new RustContract(params);

            await this.setEnvironment();
            await this.deployContract();
        } catch (e) {
            if (this._contract) {
                try {
                    this._contract.dispose();
                } catch {}
            }

            throw e;
        }
    }

    private async deployContract(): Promise<void> {
        if (this.deploymentStates.size > 0) {
            return;
        }

        const statesBackup = new Map(this.states);
        const calldata = this._deploymentCalldata || Buffer.alloc(0);

        let error: Error | undefined;
        await this.contract.onDeploy(calldata).catch(async (e: unknown) => {
            error = (await e) as Error;

            // Restore states
            this.states.clear();
            this.states = statesBackup;

            this.dispose();

            return undefined;
        });

        if (error) {
            throw this.handleError(error);
        }

        this.deploymentStates = new Map(this.states);
    }

    private async deployContractAtAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        return new Promise((resolve) => {
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

            newContract.init();

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

    private checkReentrancy(calls: Address[]): void {
        /*if (this.callStack.length !== new Set(this.callStack).size) {
            console.log(this.callStack);

            throw new Error(`OPNET: REENTRANCY DETECTED`);
        }*/

        if (DISABLE_REENTRANCY_GUARD) {
            return;
        }

        if (calls.includes(this.address)) {
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
            this.info(`Attempting to call contract ${contractAddress}`);
        }

        const contract: ContractRuntime = Blockchain.getContract(contractAddress);
        //const callResponse = await contract.onCall(calldata, this.address, Blockchain.txOrigin);

        const code = contract.bytecode;
        const ca = new ContractRuntime(contractAddress, contract.deployer, contract.gasLimit, code);
        ca.preserveState();
        ca.setStates(contract.getStates());

        ca.init();
        const callResponse = await ca.onCall(calldata, this.address, Blockchain.txOrigin);
        contract.setStates(ca.getStates());

        try {
            ca.delete();
        } catch {}

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

        const event = new NetEvent(eventName, 0n, eventData);
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
            address: this.address,
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
