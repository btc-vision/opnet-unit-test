# ContractRuntime Class Documentation

The `ContractRuntime` class is designed to be extended by developers to define and manage their own smart contracts
within the OPNet blockchain environment. This class provides the necessary framework to handle contract execution, state
management, and interactions with other contracts.

## Constructor

### `constructor(address: Address, deployer: Address, gasLimit?: bigint, potentialBytecode?: Buffer)`

- **Description**: Initializes the `ContractRuntime` class with the contract's address, deployer, gas limit, and
  optional bytecode.
- **Parameters**:
    - `address`: The address of the contract.
    - `deployer`: The address of the deployer of the contract.
    - `gasLimit`: The gas limit for the contract execution (default is `300_000_000_000n`).
    - `potentialBytecode`: Optional bytecode for the contract.

## Public Methods

### `preserveState(): void`

- **Description**: Ensures that the contract's state is preserved between calls. This method should be used if the
  contract's state needs to be maintained across different interactions.
- **Usage**:
  ```typescript
  this.preserveState();
  ```

### `getStates(): Map<bigint, bigint>`

- **Description**: Returns the current state of the contract as a map of state variables.
- **Returns**: A `Map<bigint, bigint>` containing the contract's state.
- **Usage**:
  ```typescript
  const states = this.getStates();
  ```

### `delete(): void`

- **Description**: Deletes the contract by disposing of its resources and removing its reference.
- **Usage**:
  ```typescript
  this.delete();
  ```

### `resetStates(): Promise<void>`

- **Description**: Clears the contract's state, effectively resetting it.
- **Usage**:
  ```typescript
  await this.resetStates();
  ```

### `getViewAbi(): Promise<void>`

- **Description**: Loads and sets the view ABI (Application Binary Interface) of the contract.
- **Usage**:
  ```typescript
  await this.getViewAbi();
  ```

### `getWriteMethods(): Promise<void>`

- **Description**: Loads and sets the write methods ABI of the contract.
- **Usage**:
  ```typescript
  await this.getWriteMethods();
  ```

### `setEnvironment(sender?: Address, from?: Address, currentBlock?: bigint, owner?: Address, address?: Address): Promise<void>`

- **Description**: Sets the environment for the contract execution, including sender, from address, current block
  number, owner, and contract address.
- **Parameters**:
    - `sender`: The address initiating the transaction (default is the deployer).
    - `from`: The address from which the transaction originates (default is the deployer).
    - `currentBlock`: The current block number (default is the blockchain's block number).
    - `owner`: The owner of the contract (default is the deployer).
    - `address`: The address of the contract (default is the contract's address).
- **Usage**:
  ```typescript
  await this.setEnvironment();
  ```

### `getEvents(): Promise<NetEvent[]>`

- **Description**: Retrieves the events emitted by the contract during execution.
- **Returns**: A `Promise` that resolves to an array of `NetEvent` objects.
- **Usage**:
  ```typescript
  const events = await this.getEvents();
  ```

### `backupStates(): void`

- **Description**: Backs up the current state of the contract.
- **Usage**:
  ```typescript
  this.backupStates();
  ```

### `restoreStates(): void`

- **Description**: Restores the contract's state from the backup.
- **Usage**:
  ```typescript
  this.restoreStates();
  ```

### `isReadonlyMethod(selector: Selector): boolean`

- **Description**: Checks if a method is a read-only method based on its selector.
- **Parameters**:
    - `selector`: The selector of the method.
- **Returns**: `true` if the method is read-only, otherwise `false`.
- **Usage**:
  ```typescript
  const isReadOnly = this.isReadonlyMethod(selector);
  ```

### `onCall(data: Buffer | Uint8Array, sender: Address, from: Address): Promise<CallResponse>`

- **Description**: Handles external calls to the contract. This method processes the call, executes the appropriate
  method, and returns the response.
- **Parameters**:
    - `data`: The calldata for the method.
    - `sender`: The address initiating the call.
    - `from`: The address from which the call originates.
- **Returns**: A `Promise` that resolves to a `CallResponse` object containing the response data, events, call stack,
  and used gas.
- **Usage**:
  ```typescript
  const response = await this.onCall(calldata, sender, from);
  ```

### `dispose(): void`

- **Description**: Disposes of the contract, freeing up resources and resetting its state.
- **Usage**:
  ```typescript
  this.dispose();
  ```

### `init(): Promise<void>`

- **Description**: Initializes the contract by loading its bytecode, setting up the environment, and preparing it for
  execution.
- **Usage**:
  ```typescript
  await this.init();
  ```

## Protected Methods

### `readMethod(selector: number, calldata: Buffer, sender?: Address, from?: Address): Promise<CallResponse>`

- **Description**: Executes a write method (one that modifies the state) based on the provided selector and calldata.
- **Parameters**:
    - `selector`: The selector of the method to execute.
    - `calldata`: The calldata for the method.
    - `sender`: (Optional) The address initiating the call.
    - `from`: (Optional) The address from which the call originates.
- **Returns**: A `Promise` that resolves to a `CallResponse` object containing the response data, events, call stack,
  and used gas.
- **Usage**:
  ```typescript
  const response = await this.readMethod(selector, calldata, sender, from);
  ```

### `readView(selector: number, sender?: Address, from?: Address): Promise<CallResponse>`

- **Description**: Executes a view method (a read-only method) based on the provided selector.
- **Parameters**:
    - `selector`: The selector of the method to execute.
    - `sender`: (Optional) The address initiating the call.
    - `from`: (Optional) The address from which the call originates.
- **Returns**: A `Promise` that resolves to a `CallResponse` object containing the response data, events, call stack,
  and used gas.
- **Usage**:
  ```typescript
  const response = await this.readView(selector, sender, from);
  ```

### `handleError(error: Error): Error`

- **Description**: Handles errors that occur during contract execution, adding context related to the contract's
  address.
- **Parameters**:
    - `error`: The error that occurred.
- **Returns**: An `Error` object with additional context information.
- **Usage**:
  ```typescript
  const handledError = this.handleError(error);
  ```

### `defineRequiredBytecodes(): void`

- **Description**: Defines and sets the required bytecodes for the contract. If `potentialBytecode` is provided in the
  constructor, it is set as the contract's bytecode.
- **Usage**:
  ```typescript
  this.defineRequiredBytecodes();
  ```

### `loadContract(): Promise<void>`

- **Description**: Loads the contract's bytecode, initializes its environment, and prepares it for execution.
- **Usage**:
  ```typescript
  await this.loadContract();
  ```
