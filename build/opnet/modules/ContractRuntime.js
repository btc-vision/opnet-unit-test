import { ABICoder, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import bitcoin from 'bitcoinjs-lib';
import { Logger } from '@btc-vision/logger';
import { BytecodeManager } from './GetBytecode.js';
import { Blockchain } from '../../blockchain/Blockchain.js';
import { BitcoinNetworkRequest } from '@btc-vision/op-vm';
import { RustContract } from '../vm/RustContract.js';
export class ContractRuntime extends Logger {
    address;
    deployer;
    gasLimit;
    potentialBytecode;
    logColor = '#39b2f3';
    gasUsed = 0n;
    states = new Map();
    shouldPreserveState = false;
    events = [];
    deployedContracts = new Map();
    abiCoder = new ABICoder();
    callStack = [];
    statesBackup = new Map();
    network = Blockchain.network;
    constructor(address, deployer, gasLimit = 300000000000n, potentialBytecode) {
        super();
        this.address = address;
        this.deployer = deployer;
        this.gasLimit = gasLimit;
        this.potentialBytecode = potentialBytecode;
    }
    _contract;
    get contract() {
        if (!this._contract) {
            throw new Error('Contract not initialized');
        }
        return this._contract;
    }
    _bytecode;
    get bytecode() {
        if (!this._bytecode)
            throw new Error(`Bytecode not found`);
        return this._bytecode;
    }
    preserveState() {
        this.shouldPreserveState = true;
    }
    getStates() {
        return this.states;
    }
    delete() {
        this.dispose();
        delete this._contract;
    }
    resetStates() {
        this.states.clear();
    }
    async setEnvironment(msgSender = Blockchain.msgSender || this.deployer, txOrigin = Blockchain.txOrigin || this.deployer, currentBlock = Blockchain.blockNumber, owner = this.deployer, address = this.address) {
        const writer = new BinaryWriter();
        writer.writeAddress(msgSender);
        writer.writeAddress(txOrigin); // "leftmost thing in the call chain"
        writer.writeU256(currentBlock);
        writer.writeAddress(owner);
        writer.writeAddress(address);
        writer.writeU64(BigInt(Date.now()));
        await this.contract.setEnvironment(writer.getBuffer());
    }
    async getEvents() {
        const events = await this.contract.getEvents();
        const reader = new BinaryReader(events);
        return reader.readEvents();
    }
    backupStates() {
        this.statesBackup = new Map(this.states);
    }
    restoreStates() {
        this.states.clear();
        this.states = new Map(this.statesBackup);
    }
    async onCall(data, sender, from) {
        const reader = new BinaryReader(data);
        const selector = reader.readSelector();
        const calldata = data.subarray(4);
        if (Blockchain.traceCalls) {
            this.log(`Called externally by an other contract. Selector: ${selector.toString(16)}`);
        }
        let response;
        if (calldata.length === 0) {
            response = await this.readView(selector, sender, from);
        }
        else {
            response = await this.readMethod(selector, calldata, sender, from);
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
    dispose() {
        if (this._contract) {
            this._contract.dispose();
            this.gasUsed = this.contract.getUsedGas();
        }
    }
    async init() {
        this.defineRequiredBytecodes();
        this._bytecode = BytecodeManager.getBytecode(this.address);
        await this.loadContract();
    }
    async readMethod(selector, calldata, sender, txOrigin) {
        await this.loadContract();
        const usedGasBefore = this.contract.getUsedGas();
        if (sender) {
            await this.setEnvironment(sender, txOrigin);
        }
        const statesBackup = new Map(this.states);
        let error;
        const response = await this.contract
            .readMethod(selector, calldata)
            .catch(async (e) => {
            error = (await e);
            // Restore states
            this.states.clear();
            this.states = statesBackup;
            return undefined;
        });
        if (response) {
            const events = await this.getEvents();
            this.events = [...this.events, ...events];
        }
        const usedGas = this.contract.getUsedGas() - usedGasBefore;
        return {
            response,
            error,
            events: this.events,
            callStack: this.callStack,
            usedGas: usedGas,
        };
    }
    async readView(selector, sender, txOrigin) {
        await this.loadContract();
        const usedGasBefore = this.contract.getUsedGas();
        if (sender) {
            await this.setEnvironment(sender, txOrigin);
        }
        const statesBackup = new Map(this.states);
        let error;
        const response = await this.contract.readView(selector).catch(async (e) => {
            error = (await e);
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
    handleError(error) {
        return new Error(`(in: ${this.address}) OPNET: ${error.stack}`);
    }
    defineRequiredBytecodes() {
        if (this.potentialBytecode) {
            this._bytecode = this.potentialBytecode;
            BytecodeManager.setBytecode(this.address, this.potentialBytecode);
        }
        else {
            throw new Error('Not implemented');
        }
    }
    async loadContract() {
        try {
            if (!this.shouldPreserveState) {
                this.states.clear();
            }
            this.events = [];
            this.callStack = [this.address];
            try {
                this.dispose();
            }
            catch { }
            const params = this.generateParams();
            this._contract = new RustContract(params);
            await this.setEnvironment();
            await this.contract.defineSelectors();
        }
        catch (e) {
            if (this._contract && !this._contract.disposed) {
                this._contract.dispose();
            }
            throw e;
        }
    }
    hasModifiedStates(states, statesBackup) {
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
    async deployContractAtAddress(data) {
        const reader = new BinaryReader(data);
        const address = reader.readAddress();
        const salt = Buffer.from(reader.readBytes(32)); //Buffer.from(`${reader.readU256().toString(16)}`, 'hex');
        const saltBig = BigInt('0x' + salt.reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), ''));
        if (Blockchain.traceDeployments) {
            this.log(`This contract wants to deploy the same bytecode as ${address}. Salt: ${salt.toString('hex')} or ${saltBig}`);
        }
        const deployResult = Blockchain.generateAddress(this.address, salt, address);
        if (this.deployedContracts.has(deployResult.contractAddress)) {
            throw new Error('Contract already deployed');
        }
        if (address === this.address) {
            throw new Error('Cannot deploy the same contract');
        }
        const requestedContractBytecode = BytecodeManager.getBytecode(address);
        const newContract = new ContractRuntime(deployResult.contractAddress, this.address, this.gasLimit, requestedContractBytecode);
        newContract.preserveState();
        if (Blockchain.traceDeployments) {
            this.info(`Deploying contract at ${deployResult.contractAddress.toString()} - virtual address 0x${deployResult.virtualAddress.toString('hex')}`);
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
        return response.getBuffer();
    }
    load(data) {
        const reader = new BinaryReader(data);
        const pointer = reader.readU256();
        const value = this.states.get(pointer) || 0n;
        if (Blockchain.tracePointers) {
            this.log(`Attempting to load pointer ${pointer} - value ${value}`);
        }
        const response = new BinaryWriter();
        response.writeU256(value);
        return response.getBuffer();
    }
    store(data) {
        const reader = new BinaryReader(data);
        const pointer = reader.readU256();
        const value = reader.readU256();
        if (Blockchain.tracePointers) {
            this.log(`Attempting to store pointer ${pointer} - value ${value}`);
        }
        this.states.set(pointer, value);
        const response = new BinaryWriter();
        response.writeU256(0n);
        return response.getBuffer();
    }
    checkReentrancy(calls) {
        /*if (this.callStack.length !== new Set(this.callStack).size) {
            console.log(this.callStack);

            throw new Error(`OPNET: REENTRANCY DETECTED`);
        }*/
        if (calls.includes(this.address)) {
            throw new Error('OPNET: REENTRANCY DETECTED');
        }
    }
    async call(data) {
        const reader = new BinaryReader(data);
        const contractAddress = reader.readAddress();
        const calldata = reader.readBytesWithLength();
        if (!contractAddress) {
            throw new Error(`No contract address specified in call?`);
        }
        if (Blockchain.traceCalls) {
            this.info(`Attempting to call contract ${contractAddress}`);
        }
        const contract = Blockchain.getContract(contractAddress);
        /*const code = contract.bytecode;
        const ca = new ContractRuntime(contractAddress, contract.deployer, contract.gasLimit, code);
        ca.preserveState();

        await ca.init();*/ // TODO: Use this instead of the above line, require rework of storage slots.
        const callResponse = await contract.onCall(calldata, this.address, Blockchain.txOrigin);
        /*try {
            ca.dispose();
        } catch {}*/
        this.events = [...this.events, ...callResponse.events];
        this.callStack = [...this.callStack, ...callResponse.callStack];
        this.checkReentrancy(callResponse.callStack);
        if (!callResponse.response) {
            throw this.handleError(new Error(`OPNET: CALL_FAILED: ${callResponse.error}`));
        }
        return callResponse.response;
    }
    onLog(data) {
        const reader = new BinaryReader(data);
        const logData = reader.readStringWithLength();
        this.warn(`Contract log: ${logData}`);
    }
    getNetwork() {
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
    generateParams() {
        return {
            address: this.address,
            bytecode: this.bytecode,
            gasLimit: this.gasLimit,
            network: this.getNetwork(),
            gasCallback: this.onGas.bind(this),
            contractManager: Blockchain.contractManager,
            deployContractAtAddress: this.deployContractAtAddress.bind(this),
            load: (data) => {
                return new Promise((resolve) => {
                    resolve(this.load(data));
                });
            },
            store: (data) => {
                return new Promise((resolve) => {
                    resolve(this.store(data));
                });
            },
            call: this.call.bind(this),
            log: this.onLog.bind(this),
        };
    }
    onGas(gas, method) {
        if (Blockchain.traceGas) {
            this.debug(`Gas: ${gas}`, method);
        }
    }
}
