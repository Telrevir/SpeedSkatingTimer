const PACKET_HEADER = 0xaa
const PACKET_TRAILER = 0xf9

export interface LoraPacket {
  commandId: number
  payload: Uint8Array
}

export function encodePacket(
  commandId: number,
  payload: Uint8Array = new Uint8Array(),
): Uint8Array {
  if (!Number.isInteger(commandId) || commandId < 0 || commandId > 0xff) {
    throw new RangeError('command id must be between 0 and 255')
  }
  if (payload.length > 230) {
    throw new RangeError('payload length must be between 0 and 230')
  }

  const packet = new Uint8Array(payload.length + 5)
  packet[0] = PACKET_HEADER
  packet[1] = commandId
  packet[2] = payload.length

  let checksum = commandId + payload.length
  payload.forEach((value, index) => {
    packet[index + 3] = value
    checksum += value
  })

  packet[payload.length + 3] = checksum & 0xff
  packet[payload.length + 4] = PACKET_TRAILER
  return packet
}

export class LoraPacketDecoder {
  private buffer = new Uint8Array()

  push(chunk: Uint8Array): LoraPacket[] {
    const combined = new Uint8Array(this.buffer.length + chunk.length)
    combined.set(this.buffer)
    combined.set(chunk, this.buffer.length)
    this.buffer = combined

    const packets: LoraPacket[] = []
    while (this.buffer.length > 0) {
      const headerIndex = this.buffer.indexOf(PACKET_HEADER)
      if (headerIndex < 0) {
        this.buffer = new Uint8Array()
        break
      }
      if (headerIndex > 0) {
        this.buffer = this.buffer.slice(headerIndex)
      }
      if (this.buffer.length < 5) {
        break
      }

      const payloadLength = this.buffer[2]!
      if (payloadLength > 230) {
        this.buffer = this.buffer.slice(1)
        continue
      }
      const packetLength = payloadLength + 5
      if (this.buffer.length < packetLength) {
        break
      }

      const commandId = this.buffer[1]!
      const payload = this.buffer.slice(3, 3 + payloadLength)
      const trailer = this.buffer[packetLength - 1]!
      const packetChecksum = this.buffer[packetLength - 2]!
      let checksum = commandId + payloadLength
      payload.forEach((value) => {
        checksum += value
      })
      if (trailer !== PACKET_TRAILER || (checksum & 0xff) !== packetChecksum) {
        this.buffer = this.buffer.slice(1)
        continue
      }

      packets.push({ commandId, payload })
      this.buffer = this.buffer.slice(packetLength)
    }
    return packets
  }
}
