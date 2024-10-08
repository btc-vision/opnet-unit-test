import * as crypto from 'crypto';

function sha256(buffer: Buffer): Buffer {
    const sha = crypto.createHash('sha256');
    sha.update(Uint8Array.from(buffer));

    return sha.digest();
}

function hash256(buffer: Buffer): Buffer {
    return sha256(sha256(buffer));
}

const test = Buffer.from('', 'hex');

console.log(hash256(test).toString('hex'));
