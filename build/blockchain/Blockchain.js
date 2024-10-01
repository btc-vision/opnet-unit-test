import { Logger } from '@btc-vision/logger';
import { ContractManager } from '@btc-vision/op-vm';
import { AddressGenerator, EcKeyPair, TapscriptVerificator } from '@btc-vision/transaction';
import bitcoin from 'bitcoinjs-lib';
import { NETWORK, TRACE_CALLS, TRACE_DEPLOYMENTS, TRACE_GAS, TRACE_POINTERS, } from '../contracts/configs.js';
import { BytecodeManager } from '../opnet/modules/GetBytecode.js';
class BlockchainBase extends Logger {
    network;
    logColor = '#8332ff';
    DEAD_ADDRESS = 'bc1dead';
    traceGas = TRACE_GAS;
    tracePointers = TRACE_POINTERS;
    traceCalls = TRACE_CALLS;
    traceDeployments = TRACE_DEPLOYMENTS;
    enableDebug = false;
    contracts = new Map();
    bindings = new Map();
    constructor(network) {
        super();
        this.network = network;
    }
    createManager() {
        this._contractManager = new ContractManager(16, // max idling runtime
        this.loadJsFunction, this.storeJSFunction, this.callJSFunction, this.deployContractAtAddressJSFunction, this.logJSFunction);
    }
    removeBinding(id) {
        this.bindings.delete(id);
    }
    registerBinding(binding) {
        this.bindings.set(binding.id, binding);
    }
    loadJsFunction = (_, value) => {
        if (this.enableDebug)
            console.log('LOAD', value.buffer);
        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }
        return c.load(buf);
    };
    storeJSFunction = (_, value) => {
        if (this.enableDebug)
            console.log('STORE', value.buffer);
        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }
        return c.store(buf);
    };
    callJSFunction = (_, value) => {
        if (this.enableDebug)
            console.log('CALL', value.buffer);
        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }
        return c.call(buf);
    };
    deployContractAtAddressJSFunction = (_, value) => {
        if (this.enableDebug)
            console.log('DEPLOY', value.buffer);
        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }
        return c.deployContractAtAddress(buf);
    };
    logJSFunction = (_, value) => {
        return new Promise(() => {
            // temporary
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
            const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
            if (!c) {
                throw new Error('Binding not found');
            }
            return c.log(buf);
        });
    };
    _contractManager;
    get contractManager() {
        if (!this._contractManager) {
            this.createManager();
        }
        if (!this._contractManager) {
            throw new Error('Contract manager not initialized');
        }
        return this._contractManager;
    }
    _blockNumber = 1n;
    get blockNumber() {
        return this._blockNumber;
    }
    set blockNumber(blockNumber) {
        this._blockNumber = blockNumber;
    }
    _msgSender = '';
    get msgSender() {
        return this._msgSender;
    }
    set msgSender(sender) {
        this._msgSender = sender;
    }
    _txOrigin = '';
    get txOrigin() {
        return this._txOrigin;
    }
    set txOrigin(from) {
        this._txOrigin = from;
    }
    generateRandomSegwitAddress() {
        return AddressGenerator.generatePKSH(this.getRandomBytes(32), this.network);
    }
    generateRandomTaprootAddress() {
        const keypair = EcKeyPair.generateRandomKeyPair(this.network);
        return EcKeyPair.getTaprootAddress(keypair, this.network);
    }
    register(contract) {
        if (this.contracts.has(contract.address)) {
            throw new Error(`Contract already registered at address ${contract.address}`);
        }
        this.contracts.set(contract.address, contract);
    }
    clearContracts() {
        this.contracts.clear();
    }
    generateAddress(deployer, salt, from) {
        const bytecode = BytecodeManager.getBytecode(from);
        const contractVirtualAddress = TapscriptVerificator.getContractSeed(bitcoin.crypto.hash256(Buffer.from(deployer, 'utf-8')), Buffer.from(bytecode), salt);
        /** Generate contract segwit address */
        const contractSegwitAddress = AddressGenerator.generatePKSH(contractVirtualAddress, this.network);
        return { contractAddress: contractSegwitAddress, virtualAddress: contractVirtualAddress };
    }
    convertToBech32(contractVirtualAddress) {
        return AddressGenerator.generatePKSH(Buffer.from(contractVirtualAddress.slice(2), 'hex'), this.network);
    }
    getContract(address) {
        if (address.startsWith('0x')) {
            address = this.convertToBech32(address);
        }
        const contract = this.contracts.get(address);
        if (!contract) {
            throw new Error(`Contract not found at address ${address}`);
        }
        return contract;
    }
    backup() {
        for (const contract of this.contracts.values()) {
            contract.backupStates();
        }
    }
    restore() {
        for (const contract of this.contracts.values()) {
            contract.restoreStates();
        }
    }
    dispose() {
        for (const contract of this.contracts.values()) {
            contract.dispose.bind(contract)();
        }
    }
    cleanup() {
        this.contractManager.destroyAll();
        this.contractManager.destroy();
        delete this._contractManager;
    }
    async init() {
        this.dispose();
        for (const contract of this.contracts.values()) {
            await contract.init();
        }
    }
    expandTo18Decimals(n) {
        return BigInt(n) * 10n ** 18n;
    }
    expandToDecimal(n, decimals) {
        return BigInt(n) * 10n ** BigInt(decimals);
    }
    decodeFrom18Decimals(n) {
        return Number(n / 10n ** 18n);
    }
    decodeFromDecimal(n, decimals) {
        return Number(n / 10n ** BigInt(decimals));
    }
    mineBlock() {
        this._blockNumber += 1n;
    }
    enableGasTracking() {
        this.traceGas = true;
    }
    disableGasTracking() {
        this.traceGas = false;
    }
    enablePointerTracking() {
        this.tracePointers = true;
    }
    disablePointerTracking() {
        this.tracePointers = false;
    }
    enableCallTracking() {
        this.traceCalls = true;
    }
    disableCallTracking() {
        this.traceCalls = false;
    }
    encodePrice(reserve0, reserve1) {
        const shift = 2n ** 112n;
        const price0 = (reserve1 * shift) / reserve0;
        const price1 = (reserve0 * shift) / reserve1;
        return [price0, price1];
    }
    getRandomBytes(length) {
        return Buffer.from(crypto.getRandomValues(new Uint8Array(length)));
    }
}
export const Blockchain = new BlockchainBase(NETWORK);
