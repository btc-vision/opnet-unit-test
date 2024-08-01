import * as crypto from 'crypto';
import { BinaryWriter } from '@btc-vision/bsi-binary';

function sha256(buffer: Buffer): Buffer {
    const sha = crypto.createHash('sha256');

    sha.update(buffer);

    return sha.digest();
}

function hash256(buffer: Buffer): Buffer {
    return sha256(sha256(buffer));
}

const test = Buffer.from(
    '6263727431716161376774787665687037717171796e797133757a643066616461786761776c356c343363640000000000000000000000000000000000000000000062637274317163387464676d74767435756a796b65717976706c656c6d6a3867366e666d687a70737261353600000000000000000000000000000000000000000000',
    'hex',
);


console.log(hash256(test).toString('hex'));
