/**
 * @file A minimal ZIP writer/reader over `node:zlib` — the plugin engine's
 * archive core, in-process and dependency-free.
 *
 * `scripts/lib/zip.mjs` already zips, but through `spawnSync` +
 * `Compress-Archive`, which is the right trade for a build script (it runs
 * once, on the machine that owns the tree) and the wrong one for a ROUTE: a
 * request that shells out to PowerShell serializes on a global process spawn,
 * inherits its codepage quirks, and cannot build an archive in memory to hand
 * to `Response` without a temp-file dance. So the engine gets the ~200 lines
 * of actual ZIP format instead: local headers + central directory + EOCD,
 * `deflateRawSync`/`inflateRawSync` for the bytes, and a CRC32 check on read —
 * because a truncated or bit-rotted package that unpacks "successfully" is the
 * silent-wrong-answer this project spends its guard budget avoiding.
 *
 * Deliberately NOT general: no ZIP64 (a plugin package approaching 4 GB is a
 * bug elsewhere), no encryption, no streaming. Member names are UTF-8 (flag
 * bit 11), forward-slashed, and RELATIVE — `packZip` throws on an absolute or
 * `..`-containing name rather than normalising it, the same refusal posture as
 * `badName` in the expenses files route: a rejected name is rejected, never
 * quietly rewritten into a different file.
 *
 * Containment on EXTRACT is the caller's duty and stated here so it is never
 * assumed: `readZip` returns entries in memory and guards only the name shape;
 * whoever writes them to disk must resolve-then-contain against its root
 * (`path.resolve` + `startsWith(root + path.sep)`), the same idiom
 * `scripts/lib/zip.mjs` uses against zip-slip.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Forward-slashed relative path inside the archive. */
  readonly name: string;
  readonly data: Buffer;
}

/* ── CRC32 (IEEE 802.3 polynomial, the one ZIP specifies) ─────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── the name fence ───────────────────────────────────────────────────────── */

/**
 * A member name must be a forward-slashed relative path with no `..` segment,
 * no drive letter, no leading slash and no NUL. Checked on BOTH sides — a
 * package this engine writes cannot contain one, and a package it reads is
 * refused entry-by-entry rather than sanitised.
 */
export function badMemberName(name: string): string | null {
  if (!name || name.length > 512) return "empty or over-long member name";
  if (name.includes("\0")) return "member name contains NUL";
  if (name.includes("\\")) return "member name uses backslashes";
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return "member name is absolute";
  if (name.split("/").some((seg) => seg === "" || seg === "." || seg === ".."))
    return "member name contains an empty, `.` or `..` segment";
  return null;
}

/* ── write ────────────────────────────────────────────────────────────────── */

/** DOS time fields for a fixed, deterministic stamp: packages built from the
 *  same bytes are byte-identical, which is what lets a test compare archives
 *  and a re-export be recognised as unchanged. 2026-01-01 00:00:00. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function packZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  for (const entry of sorted) {
    const problem = badMemberName(entry.name);
    if (problem) throw new Error(`zip member "${entry.name}": ${problem}`);
    if (seen.has(entry.name)) throw new Error(`zip member "${entry.name}" appears twice`);
    seen.add(entry.name);

    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    // Store uncompressed when deflate does not help — tiny or already-packed
    // members — the same choice every mainstream zipper makes.
    const useDeflate = deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal attrs, external attrs: all zero
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, payload);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ── read ─────────────────────────────────────────────────────────────────── */

/**
 * Parse an archive fully into memory. Throws on a malformed archive, a member
 * whose name fails the fence, or a member whose bytes do not match their
 * recorded CRC — all with the member named, because "bad zip" from an importer
 * is a puzzle and "member x: crc mismatch" is a message.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // EOCD: scan back from the end (a trailing comment can push it inward, and
  // refusing commented archives would refuse other tools' honest output).
  const scanFloor = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`central directory truncated at entry ${n} of ${count}`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const rawSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    pos += 46 + nameLen + extraLen + commentLen;

    // Directory entries (trailing slash, zero bytes) carry no data worth
    // keeping — files state their paths in full.
    if (name.endsWith("/") && rawSize === 0) continue;

    const problem = badMemberName(name);
    if (problem) throw new Error(`zip member "${name}": ${problem}`);
    if (method !== 0 && method !== 8) {
      throw new Error(`zip member "${name}": unsupported compression method ${method}`);
    }

    // The local header's own name/extra lengths can differ from the central
    // ones (some zippers pad extra fields), so the data offset must be read
    // from the LOCAL header, never assumed from the central record.
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`zip member "${name}": local header missing`);
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) {
      throw new Error(`zip member "${name}": data truncated`);
    }
    const payload = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);
    if (data.length !== rawSize) {
      throw new Error(`zip member "${name}": size mismatch (${data.length} != ${rawSize})`);
    }
    if (crc32(data) !== crc) throw new Error(`zip member "${name}": crc mismatch`);
    entries.push({ name, data });
  }
  return entries;
}
