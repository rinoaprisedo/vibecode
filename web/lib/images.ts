export type Attachment = { key: string; name: string; blob: Blob; preview: string };

const MAX_SIDE = 1568;          // larger images are scaled down: the model downsizes them anyway
const MAX_COUNT = 8;
const OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export const MAX_ATTACHMENTS = MAX_COUNT;
export const isImage = (f: File) => OK.includes(f.type);

// Scales big images down and normalises GIF/WebP to PNG so every attachment is a plain still image.
export async function toAttachment(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const keepAsIs = scale === 1 && (file.type === "image/png" || file.type === "image/jpeg");
  let blob: Blob = file;
  if (!keepAsIs) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read image"))), type, 0.9));
  }
  bitmap.close();
  return { key: crypto.randomUUID(), name: file.name || "pasted-image", blob, preview: URL.createObjectURL(blob) };
}
