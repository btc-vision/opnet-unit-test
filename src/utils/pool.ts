import fs from 'fs';
import bitcoin from '@btc-vision/bitcoin';

const pool = fs.readFileSync('./bytecode/pool.wasm');

const poolBytecodeHash = bitcoin.crypto.hash256(pool);
console.log('Pool bytecode hash:', poolBytecodeHash.toString('hex'), Array.from(poolBytecodeHash));
