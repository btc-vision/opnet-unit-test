# Smart Contract Testing Framework

![Bitcoin](https://img.shields.io/badge/Bitcoin-000?style=for-the-badge&logo=bitcoin&logoColor=white)
![AssemblyScript](https://img.shields.io/badge/assembly%20script-%23000000.svg?style=for-the-badge&logo=assemblyscript&logoColor=white)
![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![NPM](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![Gulp](https://img.shields.io/badge/GULP-%23CF4647.svg?style=for-the-badge&logo=gulp&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B3263?style=for-the-badge&logo=eslint&logoColor=white)

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

This repository provides a robust framework for developing and testing smart contracts on the OPNet blockchain. The
framework includes essential tools and guidelines for ensuring your contracts are functional, secure, and performant.

## Table of Contents

- [Introduction](#introduction)
- [Project Structure](#project-structure)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Compiling Contracts and Tests](#compiling-contracts-and-tests)
- [Running Unit Tests](#running-unit-tests)
- [Adding Your Contract and Tests](#adding-your-contract-and-tests)
- [Example Contracts](#example-contracts)
- [Contributing](#contributing)
- [License](#license)

## Introduction

The **OP_NET Smart Contract Testing Framework** is designed to facilitate the development and testing of smart
contracts. It includes utilities, test cases, and a structured environment to ensure that your contracts
work as intended under various conditions.

## Project Structure

The project is organized as follows:

```
src/
├── blockchain/
│   └── Blockchain.ts          # Blockchain-related utilities and helpers
├── contracts/                 # Directory for smart contract implementations
│   ├── configs.ts             # Configuration settings for contracts
│   ├── MotoswapFactory.ts     # Example implementation of a contract
│   ├── MotoswapPool.ts        # Example implementation of a contract
│   ├── MotoswapRouter.ts      # Example implementation of a contract
│   └── OP_20.ts               # Example implementation of a contract
├── interfaces/
│   └── RouterInterfaces.ts    # Example implementation of a contract interface
├── opnet/
│   ├── modules/
│   │   ├── ContractRuntime.ts # Runtime environment for executing contracts
│   │   └── GetBytecode.ts     # Utilities for managing contract bytecode
│   ├── network/
│   │   └── NetworkPrefix.ts   # Network prefix management
│   └── unit/
│       ├── Assert.ts          # Assertion utilities for unit tests
│       ├── Assertion.ts       # Additional assertion helpers
│       └── OPNetUnit.ts       # Unit test framework for OPNet
├── tests/                     # Directory for unit tests
├── utils/                     # Utility functions and helpers
├── build/                     # Compiled outputs
├── bytecode/                  # Directory for contract bytecode files (.wasm)
```

## Features

- **Comprehensive Testing Tools**: Utilities for writing and executing unit tests in the OP_NET environment.
- **Modular Design**: Easily extend the framework with new contracts and tests.
- **Support for Complex Scenarios**: Test contracts against various scenarios, ensuring robustness.
- **Detailed Reporting**: Receive detailed feedback on test execution, including pass/fail status.

## Requirements

Ensure the following are installed before using the framework:

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Rust](https://www.rust-lang.org/)

## Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/your-username/opnet-unit-test.git
cd opnet-unit-test
npm install
```

Or, if you use Yarn:

```bash
yarn install
```

## Usage

This framework provides a set of scripts to run unit tests for your contracts. The contracts are located in
the `contracts` directory, and the corresponding tests are in the `tests` directory.

## Compiling Contracts and Tests

Before running the tests, you need to compile your contracts and test files. Use the following command:

```bash
npm run build
```

Or, alternatively:

```bash
gulp
```

This will compile your TypeScript files into JavaScript, and the output will be located in the `build/` directory.

## Running Unit Tests

To run a specific unit test, use the following command:

```bash
node build/tests/NAME_OF_TEST_FILE.js
```

Replace `NAME_OF_TEST_FILE` with the name of your test file located in the `tests/` directory.

For example, to run tests for the `router.ts` file:

```bash
node build/tests/router.js
```

## Adding Your Contract and Tests

To add and test your own contract, follow these steps:

1. **Implement Your Contract**:
    - Create a new TypeScript file in the `/src/contracts` directory with your contract implementation.

2. **Add the Contract's Bytecode**:
    - Compile your contract to WebAssembly (`.wasm`) and place the resulting binary file in the `/src/bytecode/`
      directory.

3. **Create Unit Tests**:
    - Create a new TypeScript file in the `/src/tests` directory for your unit tests.
    - Write your unit tests using the provided utilities and frameworks (e.g., `OPNetUnit`, `Assert`).

4. **Compile and Run Tests**:
    - Compile the project using `npm run build` or `gulp`.
    - Run your tests using `node build/tests/NAME_OF_TEST_FILE.js`.

### Example Test File Structure

Here's an example of what your test file might look like:

```typescript
import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { MyCustomContract } from '../contracts/MyCustomContract.ts';

await opnet('MyCustomContract Tests', async (vm: OPNetUnit) => {
    vm.beforeEach(async () => {
        // Initialize your contract here...
    });

    vm.afterEach(async () => {
        // Clean up after each test...
    });

    await vm.it('should correctly execute a function', async () => {
        // Your test logic here...
        Assert.expect(someValue).toEqual(expectedValue);
    });
});
```

## Example Contracts

Here's an example of a basic contract that users must implement to interact with their own contracts:

```typescript
import { CallResponse, ContractRuntime } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';

export class MyCustomContract extends ContractRuntime {
    // Implementation details...
}
```

### Contract Implementation Example

Let's create a simple token contract that follows the OP_20 standard (similar to ERC20 in Ethereum). This contract will
allow minting, transferring, and checking the balance of tokens.

**File: `/src/contracts/SimpleToken.ts`**

```typescript
import { ContractRuntime, CallResponse } from '../opnet/modules/ContractRuntime.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { Blockchain } from '../blockchain/Blockchain.js';

export class SimpleToken extends ContractRuntime {
    private readonly mintSelector: number = Number(`0x${this.abiCoder.encodeSelector('mint')}`);
    private readonly transferSelector: number = Number(`0x${this.abiCoder.encodeSelector('transfer')}`);
    private readonly balanceOfSelector: number = Number(`0x${this.abiCoder.encodeSelector('balanceOf')}`);

    constructor(
        address: Address,
        public readonly decimals: number,
        gasLimit: bigint = 300_000_000_000n,
    ) {
        super(address, 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn', gasLimit);
        this.preserveState();
    }

    public async mint(to: Address, amount: bigint): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        calldata.writeU256(amount);

        const result = await this.readMethod(
            this.mintSelector,
            Buffer.from(calldata.getBuffer()),
            this.deployer,
            this.deployer,
        );

        if (!result.response) {
            this.dispose();
            throw result.error;
        }

        const reader = new BinaryReader(result.response);
        if (!reader.readBoolean()) {
            throw new Error('Mint failed');
        }
    }

    public async transfer(from: Address, to: Address, amount: bigint): Promise<void> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(to);
        calldata.writeU256(amount);

        const result = await this.readMethod(
            this.transferSelector,
            Buffer.from(calldata.getBuffer()),
            from,
            from,
        );

        if (!result.response) {
            this.dispose();
            throw result.error;
        }

        const reader = new BinaryReader(result.response);
        if (!reader.readBoolean()) {
            throw new Error('Transfer failed');
        }
    }

    public async balanceOf(owner: Address): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeAddress(owner);

        const result = await this.readMethod(
            this.balanceOfSelector,
            Buffer.from(calldata.getBuffer()),
        );

        if (!result.response) {
            this.dispose();
            throw result.error;
        }

        const reader = new BinaryReader(result.response);
        return reader.readU256();
    }
}
```

### Unit Test Example

Now let's create a unit test for the `SimpleToken` contract. We'll test minting tokens, transferring tokens, and
checking the balance.

**File: `/src/tests/simpleTokenTest.ts`**

```typescript
import { opnet, OPNetUnit } from '../opnet/unit/OPNetUnit.js';
import { Assert } from '../opnet/unit/Assert.js';
import { Blockchain } from '../blockchain/Blockchain.js';
import { SimpleToken } from '../contracts/SimpleToken.js';
import { Address } from '@btc-vision/bsi-binary';

const decimals = 18;
const totalSupply = 1000000n * (10n ** BigInt(decimals));
const deployer: Address = Blockchain.generateRandomSegwitAddress();
const receiver: Address = Blockchain.generateRandomSegwitAddress();

await opnet('SimpleToken Contract', async (vm: OPNetUnit) => {
    let token: SimpleToken;

    vm.beforeEach(async () => {
        Blockchain.dispose();
        token = new SimpleToken(deployer, decimals);
        Blockchain.register(token);

        await Blockchain.init();
    });

    vm.afterEach(async () => {
        token.dispose();
    });

    await vm.it('should mint tokens correctly', async () => {
        await token.mint(receiver, totalSupply);

        const balance = await token.balanceOf(receiver);
        Assert.expect(balance).toEqual(totalSupply);
    });

    await vm.it('should transfer tokens correctly', async () => {
        await token.mint(deployer, totalSupply);

        const transferAmount = 100000n * (10n ** BigInt(decimals));
        await token.transfer(deployer, receiver, transferAmount);

        const balanceDeployer = await token.balanceOf(deployer);
        const balanceReceiver = await token.balanceOf(receiver);

        Assert.expect(balanceDeployer).toEqual(totalSupply - transferAmount);
        Assert.expect(balanceReceiver).toEqual(transferAmount);
    });

    await vm.it('should return correct balances', async () => {
        await token.mint(receiver, totalSupply);

        const balance = await token.balanceOf(receiver);
        Assert.expect(balance).toEqual(totalSupply);

        const balanceDeployer = await token.balanceOf(deployer);
        Assert.expect(balanceDeployer).toEqual(0n);
    });
});
```

### Explanation

- **SimpleToken Contract**: This contract implements a simple token with minting, transferring, and balance checking
  functions.
    - **mint**: Mints tokens to a specified address.
    - **transfer**: Transfers tokens from one address to another.
    - **balanceOf**: Returns the balance of a specified address.

- **simpleTokenTest.ts**: This test suite covers the main functionality of the `SimpleToken` contract.
    - **beforeEach**: Initializes a new instance of the `SimpleToken` contract before each test case.
    - **afterEach**: Disposes of the contract instance after each test case.
    - **Test Cases**:
        - **should mint tokens correctly**: Tests that tokens are correctly minted to a given address.
        - **should transfer tokens correctly**: Tests that tokens are correctly transferred from one address to another.
        - **should return correct balances**: Tests that the balance checking function returns the expected results.

### How to Use

1. **Add the Contract**: Place the `SimpleToken.ts` file in the `/src/contracts/` directory.
2. **Add the Test**: Place the `simpleTokenTest.ts` file in the `/src/tests/` directory.
3. **Compile the Project**: Run `npm run build` or `gulp` to compile the contracts and tests.
4. **Run the Test**: Execute the test with `node build/tests/simpleTokenTest.js`.

5. **Add Bytecode**: Ensure that the compiled WebAssembly bytecode for the `SimpleToken` contract is added to
   the `/src/bytecode/` directory.

This example provides a foundation for implementing and testing smart contracts within your OP_NET environment. Adjust
and extend the example as needed to fit your project's requirements.

### Learn more

For more advanced documentation please click [here](docs/README.md).

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Commit your changes (`git commit -am 'Add new feature'`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Open a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
