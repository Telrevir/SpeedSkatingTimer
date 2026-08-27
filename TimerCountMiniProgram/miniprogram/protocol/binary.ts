export function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

export function readUint24BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!
}

export function writeUint16BE(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError('数值必须是 0 到 65535 的整数')
  }
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff)
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim()
  if (normalized.length === 0
      || normalized.length % 2 !== 0
      || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('必须提供偶数位十六进制文本')
  }
  const bytes: number[] = []
  for (let offset = 0; offset < normalized.length; offset += 2) {
    bytes.push(Number.parseInt(normalized.slice(offset, offset + 2), 16))
  }
  return Uint8Array.from(bytes)
}

export function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = []
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

export function utf8String(bytes: Uint8Array): string {
  const encoded = [...bytes]
    .map((value) => `%${value.toString(16).padStart(2, '0')}`)
    .join('')
  return decodeURIComponent(encoded)
}
