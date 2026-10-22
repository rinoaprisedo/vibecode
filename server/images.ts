import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DATA_DIR } from "./paths";

const DIR = join(DATA_DIR, "images");
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const ID = /^[a-f0-9]{40}\.(png|jpg|gif|webp)$/;
const MAX_BYTES = 10 * 1024 * 1024;

// Pasted/attached images live as files (named by content hash) so chat JSON stays small.
export const images = {
  async save(mime: string, bytes: Uint8Array): Promise<string> {
    const ext = TYPES[mime];
    if (!ext) throw new Error("Unsupported image type");
    if (bytes.byteLength > MAX_BYTES) throw new Error("Image is too large (max 10 MB)");
    const id = `${createHash("sha1").update(bytes).digest("hex")}.${ext}`;
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, id), bytes);
    return id;
  },
  async read(id: string): Promise<{ data: Buffer; mime: string }> {
    if (!ID.test(id)) throw new Error("bad image id");
    return { data: await readFile(join(DIR, id)), mime: MIME[id.split(".")[1]] };
  },
};
