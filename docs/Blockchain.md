# Blockchain Class Documentation

The `Blockchain` class provides a set of public methods to manage and interact with contracts on a simulated blockchain
environment. Below is a detailed list of the available public methods, along with their descriptions and examples of
usage.

## Constructor

### `constructor(network: Network)`

- **Description**: Initializes the `BlockchainBase` class with the specified Bitcoin network.
- **Parameters**:
    - `network`: The Bitcoin network to be used (e.g., `@btc-vision/bitcoin` networks like `regtest`, `testnet`, etc.).
- **Usage**:
  ```typescript
  const blockchain = new BlockchainBase(networks.regtest);
  ```

## Public Methods

### `generateRandomAddress(): Address`

- **Description**: Generates a random SegWit (P2SH) address using the Bitcoin network associated with
  the `BlockchainBase` instance.
- **Usage**:
  ```typescript
  const address = blockchain.generateRandomAddress();
  ```

### `generateRandomAddress(): Address`

- **Description**: Generates a random Taproot address using the Bitcoin network associated with the `BlockchainBase`
  instance.
- **Usage**:
  ```typescript
  const address = blockchain.generateRandomAddress();
  ```

### `register(contract: ContractRuntime): void`

- **Description**: Registers a contract with the blockchain. Throws an error if the contract is already registered.
- **Parameters**:
    - `contract`: The contract to be registered.
- **Usage**:
  ```typescript
  blockchain.register(contract);
  ```

### `clearContracts(): void`

- **Description**: Clears all registered contracts from the blockchain.
- **Usage**:
  ```typescript
  blockchain.clearContracts();
  ```

###

`generateAddress(deployer: Address, salt: Buffer, from: Address): { contractAddress: Address; virtualAddress: Buffer }`

- **Description**: Generates a contract address and virtual address based on the deployer, salt, and the bytecode of the
  contract.
- **Parameters**:
    - `deployer`: The address of the deployer.
    - `salt`: A buffer used as a salt for address generation.
    - `from`: The address from which the contract is deployed.
- **Returns**: An object containing the generated contract address and virtual address.
- **Usage**:
  ```typescript
  const { contractAddress, virtualAddress } = blockchain.generateAddress(deployer, salt, from);
  ```

### `convertToBech32(contractVirtualAddress: Address): Address`

- **Description**: Converts a virtual address to a Bech32 address.
- **Parameters**:
    - `contractVirtualAddress`: The virtual address to be converted.
- **Returns**: The Bech32 encoded address.
- **Usage**:
  ```typescript
  const bech32Address = blockchain.convertToBech32(virtualAddress);
  ```

### `getContract(address: Address): ContractRuntime`

- **Description**: Retrieves a registered contract by its address. Converts the address to Bech32 format if necessary.
  Throws an error if the contract is not found.
- **Parameters**:
    - `address`: The address of the contract.
- **Returns**: The contract associated with the specified address.
- **Usage**:
  ```typescript
  const contract = blockchain.getContract(contractAddress);
  ```

### `backup(): void`

- **Description**: Calls the `backupStates` method on all registered contracts, saving their current states.
- **Usage**:
  ```typescript
  blockchain.backup();
  ```

### `restore(): void`

- **Description**: Calls the `restoreStates` method on all registered contracts, restoring their saved states.
- **Usage**:
  ```typescript
  blockchain.restore();
  ```

### `dispose(): void`

- **Description**: Disposes of all registered contracts, cleaning up resources.
- **Usage**:
  ```typescript
  blockchain.dispose();
  ```

### `async init(): Promise<void>`

- **Description**: Initializes all registered contracts, disposing of any previous states first.
- **Usage**:
  ```typescript
  await blockchain.init();
  ```

### `expandTo18Decimals(n: number): bigint`

- **Description**: Converts a number to a bigint representation with 18 decimals.
- **Parameters**:
    - `n`: The number to be converted.
- **Returns**: The bigint representation of the number with 18 decimals.
- **Usage**:
  ```typescript
  const bigIntValue = blockchain.expandTo18Decimals(100);
  ```

### `expandToDecimal(n: number, decimals: number): bigint`

- **Description**: Converts a number to a bigint representation with the specified number of decimals.
- **Parameters**:
    - `n`: The number to be converted.
    - `decimals`: The number of decimals.
- **Returns**: The bigint representation of the number with the specified decimals.
- **Usage**:
  ```typescript
  const bigIntValue = blockchain.expandToDecimal(100, 8);
  ```

### `decodeFrom18Decimals(n: bigint): number`

- **Description**: Decodes a bigint with 18 decimals back into a number.
- **Parameters**:
    - `n`: The bigint value to be decoded.
- **Returns**: The decoded number.
- **Usage**:
  ```typescript
  const numberValue = blockchain.decodeFrom18Decimals(bigIntValue);
  ```

### `decodeFromDecimal(n: bigint, decimals: number): number`

- **Description**: Decodes a bigint with the specified number of decimals back into a number.
- **Parameters**:
    - `n`: The bigint value to be decoded.
    - `decimals`: The number of decimals.
- **Returns**: The decoded number.
- **Usage**:
  ```typescript
  const numberValue = blockchain.decodeFromDecimal(bigIntValue, 8);
  ```

### `mineBlock(): void`

- **Description**: Increments the block number by 1, simulating the mining of a new block.
- **Usage**:
  ```typescript
  blockchain.mineBlock();
  ```

### `enableGasTracking(): void`

- **Description**: Enables gas tracking, useful for debugging and monitoring contract execution costs.
- **Usage**:
  ```typescript
  blockchain.enableGasTracking();
  ```

### `disableGasTracking(): void`

- **Description**: Disables gas tracking.
- **Usage**:
  ```typescript
  blockchain.disableGasTracking();
  ```

### `enablePointerTracking(): void`

- **Description**: Enables pointer tracking, useful for debugging pointer usage in contract executions.
- **Usage**:
  ```typescript
  blockchain.enablePointerTracking();
  ```

### `disablePointerTracking(): void`

- **Description**: Disables pointer tracking.
- **Usage**:
  ```typescript
  blockchain.disablePointerTracking();
  ```

### `enableCallTracking(): void`

- **Description**: Enables call tracking, useful for debugging the flow of contract calls.
- **Usage**:
  ```typescript
  blockchain.enableCallTracking();
  ```

### `disableCallTracking(): void`

- **Description**: Disables call tracking.
- **Usage**:
  ```typescript
  blockchain.disableCallTracking();
  ```

### `encodePrice(reserve0: bigint, reserve1: bigint): [bigint, bigint]`

- **Description**: Encodes the price based on the reserves of two assets.
- **Parameters**:
    - `reserve0`: The reserve of the first asset.
    - `reserve1`: The reserve of the second asset.
- **Returns**: A tuple containing the encoded prices `[price0, price1]`.
- **Usage**:
  ```typescript
  const [price0, price1] = blockchain.encodePrice(reserve0, reserve1);
  ```
