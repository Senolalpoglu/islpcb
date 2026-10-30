/** Parses Intel HEX text into [address, byte] pairs. Throws on a bad checksum or malformed record. */
export function parseIntelHex(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let upper = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== ':') throw new Error(`Not an Intel HEX line: ${line.slice(0, 20)}`);
    const bytes: number[] = [];
    for (let i = 1; i + 1 < line.length; i += 2) bytes.push(parseInt(line.slice(i, i + 2), 16));
    if (bytes.some(Number.isNaN)) throw new Error(`Bad hex digits: ${line.slice(0, 20)}`);
    const len = bytes[0];
    if (bytes.length !== len + 5) throw new Error(`Wrong record length: ${line.slice(0, 20)}`);
    if (bytes.reduce((a, b) => a + b, 0) % 256 !== 0) throw new Error(`Checksum mismatch: ${line.slice(0, 20)}`);
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    if (type === 0) {
      for (let i = 0; i < len; i++) out.push([upper + addr + i, bytes[4 + i]]);
    } else if (type === 1) {
      break;
    } else if (type === 2) {
      upper = ((bytes[4] << 8) | bytes[5]) << 4;
    } else if (type === 4) {
      upper = ((bytes[4] << 8) | bytes[5]) << 16;
    }
  }
  return out;
}
