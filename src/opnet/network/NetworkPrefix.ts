export enum Networks {
    MAINNET = 'mainnet',
    TESTNET = 'testnet',
    REGTEST = 'regtest',
}

export class NetworkPrefix {
    public static getPrefixForNetwork(network: Networks): string {
        switch (network) {
            case Networks.MAINNET:
                return 'bc';
            case Networks.TESTNET:
                return 'tb';
            case Networks.REGTEST:
                return 'bcrt';
        }
    }
}
