import { Blockchain } from '../../blockchain/Blockchain.js';
export class RustContract {
    refCounts = new Map();
    enableDebug = false;
    enableDisposeLog = false;
    gasUsed = 0n;
    contractManager;
    constructor(params) {
        this._params = params;
        this.contractManager = params.contractManager;
    }
    _id;
    get id() {
        if (this.disposed) {
            throw new Error('Contract is disposed.');
        }
        if (this._id == null) {
            this._id = this.contractManager.reserveId();
            Blockchain.registerBinding({
                id: this._id,
                load: this.params.load,
                store: this.params.store,
                call: this.params.call,
                deployContractAtAddress: this.params.deployContractAtAddress,
                log: this.params.log,
            });
            console.log([this._id, this.params.address, this.params.bytecode, this.params.gasLimit, this.params.network]);
            this.contractManager.instantiate(this._id, this.params.address, this.params.bytecode, this.params.gasLimit, this.params.network);
            this._instantiated = true;
        }
        return this._id;
    }
    _instantiated = false;
    get instantiated() {
        return this._instantiated;
    }
    _disposed = false;
    get disposed() {
        return this._disposed;
    }
    _params;
    get params() {
        if (!this._params) {
            throw new Error('Contract is disposed - cannot access parameters.');
        }
        return this._params;
    }
    dispose() {
        if (!this.instantiated)
            return;
        if (this._id == null) {
            throw new Error('Contract is not instantiated');
        }
        if (this.enableDebug || this.enableDisposeLog)
            console.log('Disposing contract', this._id);
        try {
            this.gasUsed = this.getUsedGas();
        }
        catch { }
        delete this._params;
        this.refCounts.clear();
        if (this.disposed)
            return;
        this._disposed = true;
        Blockchain.removeBinding(this._id);
        this.contractManager.destroyContract(this._id);
    }
    async defineSelectors() {
        if (this.enableDebug)
            console.log('Defining selectors');
        try {
            const resp = await this.contractManager.call(this.id, 'defineSelectors', []);
            this.gasCallback(resp.gasUsed, 'defineSelectors');
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in defineSelectors', e);
            const error = e;
            throw this.getError(error);
        }
    }
    async readMethod(method, buffer) {
        if (this.enableDebug)
            console.log('Reading method', method, buffer);
        try {
            const pointer = await this.__lowerTypedArray(13, 0, buffer);
            const data = await this.__retain(pointer);
            let finalResult;
            try {
                const resp = await this.contractManager.call(this.id, 'readMethod', [method, data]);
                this.gasCallback(resp.gasUsed, 'readMethod');
                const result = resp.result.filter((n) => n !== undefined);
                finalResult = this.__liftTypedArray(result[0] >>> 0);
            }
            finally {
                await this.__release(data);
            }
            return finalResult;
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in readMethod', e);
            const error = e;
            throw this.getError(error);
        }
    }
    async readView(method) {
        if (this.enableDebug)
            console.log('Reading view', method);
        let finalResult;
        try {
            const resp = await this.contractManager.call(this.id, 'readView', [method]);
            this.gasCallback(resp.gasUsed, 'readView');
            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in readView', e);
            const error = e;
            throw this.getError(error);
        }
        return finalResult;
    }
    async getEvents() {
        if (this.enableDebug)
            console.log('Getting events');
        let finalResult;
        try {
            const resp = await this.contractManager.call(this.id, 'getEvents', []);
            this.gasCallback(resp.gasUsed, 'getEvents');
            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in getEvents', e);
            const error = e;
            throw this.getError(error);
        }
        this.dispose();
        return finalResult;
    }
    async getMethodABI() {
        if (this.enableDebug)
            console.log('Getting method ABI');
        let finalResult;
        try {
            const resp = await this.contractManager.call(this.id, 'getMethodABI', []);
            this.gasCallback(resp.gasUsed, 'getMethodABI');
            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in getMethodABI', e);
            const error = e;
            throw this.getError(error);
        }
        return finalResult;
    }
    async setEnvironment(buffer) {
        if (this.enableDebug)
            console.log('Setting environment', buffer);
        try {
		console.log(buffer);
            const data = await this.__lowerTypedArray(13, 0, buffer);
            if (data == null)
                throw new Error('Data cannot be null');
            const resp = await this.contractManager.call(this.id, 'setEnvironment', [data]);
            this.gasCallback(resp.gasUsed, 'setEnvironment');
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in setEnvironment', e);
            const error = e;
            throw this.getError(error);
        }
    }
    setUsedGas(gas) {
        try {
            this.contractManager.setUsedGas(this.id, gas);
        }
        catch (e) {
            const error = e;
            throw this.getError(error);
        }
    }
    getUsedGas() {
        try {
            if (this.disposed && this.gasUsed) {
                return this.gasUsed;
            }
            return this.contractManager.getUsedGas(this.id);
        }
        catch (e) {
            const error = e;
            throw this.getError(error);
        }
    }
    useGas(amount) {
        try {
            return this.contractManager.useGas(this.id, amount);
        }
        catch (e) {
            const error = e;
            throw this.getError(error);
        }
    }
    getRemainingGas() {
        try {
            return this.contractManager.getRemainingGas(this.id);
        }
        catch (e) {
            const error = e;
            throw this.getError(error);
        }
    }
    setRemainingGas(gas) {
        try {
            this.contractManager.setRemainingGas(this.id, gas);
        }
        catch (e) {
            const error = e;
            throw this.getError(error);
        }
    }
    async __retain(pointer) {
        if (this.enableDebug)
            console.log('Retaining pointer', pointer);
        if (pointer) {
            const refcount = this.refCounts.get(pointer);
            if (refcount) {
                this.refCounts.set(pointer, refcount + 1);
            }
            else {
                const pinned = await this.__pin(pointer);
                this.refCounts.set(pinned, 1);
            }
        }
        return pointer;
    }
    async __release(pointer) {
        if (this.enableDebug)
            console.log('Releasing pointer', pointer);
        if (pointer) {
            const refcount = this.refCounts.get(pointer);
            if (refcount === 1) {
                await this.__unpin(pointer);
                this.refCounts.delete(pointer);
            }
            else if (refcount) {
                this.refCounts.set(pointer, refcount - 1);
            }
            else {
                throw Error(`invalid refcount '${refcount}' for reference '${pointer}'`);
            }
        }
    }
    __liftString(pointer) {
        if (this.enableDebug)
            console.log('Lifting string', pointer);
        if (!pointer)
            return null;
        // Read the length of the string
        const lengthPointer = pointer - 4;
        const lengthBuffer = this.contractManager.readMemory(this.id, BigInt(lengthPointer), 4n);
        const length = new Uint32Array(lengthBuffer.buffer)[0];
        const end = (pointer + length) >>> 1;
        const stringParts = [];
        let start = pointer >>> 1;
        while (end - start > 1024) {
            const chunkBuffer = this.contractManager.readMemory(this.id, BigInt(start * 2), 2048n);
            const memoryU16 = new Uint16Array(chunkBuffer.buffer);
            stringParts.push(String.fromCharCode(...memoryU16));
            start += 1024;
        }
        const remainingBuffer = this.contractManager.readMemory(this.id, BigInt(start * 2), BigInt((end - start) * 2));
        const remainingU16 = new Uint16Array(remainingBuffer.buffer);
        stringParts.push(String.fromCharCode(...remainingU16));
        return stringParts.join('');
    }
    __liftTypedArray(pointer) {
        if (this.enableDebug)
            console.log('Lifting typed array', pointer);
        if (!pointer)
            throw new Error('Pointer cannot be null');
        // Read the data offset and length
        const buffer = this.contractManager.readMemory(this.id, BigInt(pointer + 4), 8n);
        const dataView = new DataView(buffer.buffer);
        const dataOffset = dataView.getUint32(0, true);
        const length = dataView.getUint32(4, true) / Uint8Array.BYTES_PER_ELEMENT;
        // Read the actual data
        const dataBuffer = this.contractManager.readMemory(this.id, BigInt(dataOffset), BigInt(length * Uint8Array.BYTES_PER_ELEMENT));
        // Create the typed array and return its slice
        const typedArray = new Uint8Array(dataBuffer.buffer);
        return typedArray.slice();
    }
    async __lowerTypedArray(id, align, values) {
        if (this.enableDebug)
            console.log('Lowering typed array', id, align, values);
        if (values == null)
            return 0;
        const length = values.length;
        const bufferSize = length << align;
        // Allocate memory for the array
        const newPointer = await this.__new(bufferSize, 1);
        const buffer = (await this.__pin(newPointer)) >>> 0;
        const header = (await this.__new(12, id)) >>> 0;
        // Set the buffer and length in the header
        const headerBuffer = Buffer.alloc(12);
        const headerView = new DataView(headerBuffer.buffer);
        headerView.setUint32(0, buffer, true);
        headerView.setUint32(4, buffer, true);
        headerView.setUint32(8, bufferSize, true);
        this.contractManager.writeMemory(this.id, BigInt(header), headerBuffer);
        // Write the values into the buffer
        const valuesBuffer = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
        this.contractManager.writeMemory(this.id, BigInt(buffer), valuesBuffer);
        await this.__unpin(buffer);
        return header;
    }
    gasCallback(gas, method) {
        this.params.gasCallback(gas, method);
    }
    getError(err) {
        if (this.enableDebug)
            console.log('Getting error', err);
        const msg = err.message;
        if (msg.includes('Execution aborted') && !msg.includes('Execution aborted:')) {
            return this.abort();
        }
        else {
            return err;
        }
    }
    abort() {
        const abortData = this.contractManager.getAbortData(this.id);
        const message = this.__liftString(abortData.message);
        const fileName = this.__liftString(abortData.fileName);
        const line = abortData.line;
        const column = abortData.column;
        try {
            this.dispose();
        }
        catch { }
        return new Error(`Execution aborted: ${message} at ${fileName}:${line}:${column}`);
    }
    async __pin(pointer) {
        if (this.enableDebug)
            console.log('Pinning pointer', pointer);
        let finalResult;
        try {
            const resp = await this.contractManager.call(this.id, '__pin', [pointer]);
            this.gasCallback(resp.gasUsed, '__pin');
            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in __pin', e);
            const error = e;
            throw this.getError(error);
        }
        return finalResult;
    }
    async __unpin(pointer) {
        if (this.enableDebug)
            console.log('Unpinning pointer', pointer);
        let finalResult;
        try {
            const resp = await this.contractManager.call(this.id, '__unpin', [pointer]);
            this.gasCallback(resp.gasUsed, '__unpin');
            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in __unpin', e);
            const error = e;
            throw this.getError(error);
        }
        return finalResult;
    }
    async __new(size, align) {
        if (this.enableDebug)
            console.log('Creating new', size, align);
        let finalResult;
        try {
            const resp = await this.contractManager.call(this.id, '__new', [size, align]);
            this.gasCallback(resp.gasUsed, '__new');
            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        }
        catch (e) {
            if (this.enableDebug)
                console.log('Error in __new', e);
            const error = e;
            throw this.getError(error);
        }
        return finalResult;
    }
}
