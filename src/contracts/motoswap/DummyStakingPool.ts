import { Address, BinaryReader, BinaryWriter } from '@btc-vision/transaction';
import { BytecodeManager, ContractRuntime } from '@btc-vision/unit-test-framework';

export class DummyStakingPool extends ContractRuntime {
  private readonly depositSelector: number = Number(
    `0x${this.abiCoder.encodeSelector('depositAndDistributeRewards(address,uint256)')}`,
  );

  public async deposit(token: Address, amount: bigint): Promise<boolean> {
    const writer = new BinaryWriter();
    writer.writeSelector(this.depositSelector);
    writer.writeAddress(token);
    writer.writeU256(amount);

    const result = await this.execute(writer.getBuffer());

    const response = result.response;
    if (!response) {
      this.dispose();
      throw result.error;
    }

    const reader: BinaryReader = new BinaryReader(response);
    return reader.readBoolean();
  }

  constructor(deployer: Address, address: Address, gasLimit: bigint = 100_000_000_000n) {
    super({
      address,
      deployer,
      gasLimit,
    });

    this.preserveState();
  }

  protected defineRequiredBytecodes(): void {
    BytecodeManager.loadBytecode('./bytecode/dummyStaking.wasm', this.address);
  }

  protected handleError(error: Error): Error {
    return new Error(`(in staking: ${this.address}) OPNET: ${error.stack}`);
  }
}
