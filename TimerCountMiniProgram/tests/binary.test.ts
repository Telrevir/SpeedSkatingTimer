import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bytesToHex,
  hexToBytes,
  readUint16BE,
  readUint24BE,
  writeUint16BE,
  utf8Bytes,
  utf8String,
} from '../miniprogram/protocol/binary'

test('reads unsigned protocol integers in big endian order', () => {
  assert.equal(readUint16BE(Uint8Array.of(0x12, 0x34), 0), 0x1234)
  assert.equal(readUint24BE(Uint8Array.of(0x01, 0x02, 0x03), 0), 0x010203)
})

test('formats EPC bytes as uppercase hexadecimal', () => {
  assert.equal(bytesToHex(Uint8Array.of(0x33, 0x33, 0xf3, 0x37)), '3333F337')
  assert.deepEqual([...hexToBytes('3333f337')], [0x33, 0x33, 0xf3, 0x37])
  assert.throws(() => hexToBytes('123'), /偶数位十六进制/)
  assert.throws(() => hexToBytes('GG'), /偶数位十六进制/)
})

test('writes unsigned 16-bit protocol integers in big endian order', () => {
  assert.deepEqual([...writeUint16BE(0x1234)], [0x12, 0x34])
  assert.throws(() => writeUint16BE(-1), /0 到 65535/)
  assert.throws(() => writeUint16BE(65536), /0 到 65535/)
})

test('encodes an athlete name as UTF-8 bytes', () => {
  assert.deepEqual([...utf8Bytes('张三')], [0xe5, 0xbc, 0xa0, 0xe4, 0xb8, 0x89])
})

test('decodes UTF-8 athlete name bytes', () => {
  assert.equal(utf8String(Uint8Array.of(0xe5, 0xbc, 0xa0, 0xe4, 0xb8, 0x89)), '张三')
})
