/** Flattens a UF2 file into a firmware image placed at `base` (flash starts at 0x10000000 on the RP2040). */

const MAGIC0 = 0x0a324655; // "UF2\n"
const MAGIC1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;
const BLOCK = 512;

export function isUf2(bytes: Uint8Array): boolean {
  if (bytes.length < BLOCK || bytes.length % BLOCK !== 0) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(0, true) === MAGIC0 && v.getUint32(4, true) === MAGIC1;
}

export function parseUf2(bytes: Uint8Array, base = 0x10000000): Uint8Array {
  if (!isUf2(bytes)) throw new Error('Not a UF2 file');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Array<[number, Uint8Array]> = [];
  let end = 0;
  for (let off = 0; off < bytes.length; off += BLOCK) {
    if (v.getUint32(off, true) !== MAGIC0 || v.getUint32(off + 4, true) !== MAGIC1 || v.getUint32(off + BLOCK - 4, true) !== MAGIC_END) {
      throw new Error(`Corrupt UF2 block at ${off}`);
    }
    const flags = v.getUint32(off + 8, true);
    if (flags & 1) continue; // "not main flash" block
    const addr = v.getUint32(off + 12, true);
    const size = v.getUint32(off + 16, true);
    if (size > 476) throw new Error(`UF2 block payload too large at ${off}`);
    const rel = addr - base;
    if (rel < 0) throw new Error(`UF2 block below flash at ${off}`);
    chunks.push([rel, bytes.subarray(off + 32, off + 32 + size)]);
    end = Math.max(end, rel + size);
  }
  const image = new Uint8Array(end);
  for (const [rel, data] of chunks) image.set(data, rel);
  return image;
}
