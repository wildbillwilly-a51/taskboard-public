import "server-only";
import { verifiedPreview } from "./public-task-share-content";
// Passive media blocks retain inline playback, but never trust a supplied MIME
// type alone. Active formats such as SVG/HTML always remain downloads.
export function safeInlineNoteMedia(mime: string, bytes: Uint8Array) {
  if (verifiedPreview(mime, bytes) !== "none") return true;
  const b = Buffer.from(bytes),
    ascii = (start: number, end: number) =>
      b.subarray(start, end).toString("ascii");
  const ftyp = ascii(4, 8) === "ftyp",
    brands = ascii(8, Math.min(b.length, 64));
  if (mime === "image/avif") return ftyp && /avif|avis/.test(brands);
  if (mime === "audio/mpeg")
    return ascii(0, 3) === "ID3" || (b[0] === 255 && (b[1] & 224) === 224);
  if (["audio/wav", "audio/x-wav"].includes(mime))
    return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  if (["audio/ogg", "video/ogg"].includes(mime)) return ascii(0, 4) === "OggS";
  if (["audio/webm", "video/webm"].includes(mime))
    return b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (["audio/mp4", "video/mp4"].includes(mime))
    return ftyp && /isom|iso2|mp4[12]|M4[AV] |avc1/.test(brands);
  return false;
}
// SVG/HTML/XML are never rendered on the application's origin. Plain text is
// returned in JSON and displayed as text, not served as active browser content.
export function safeFilePreview(name: string, mime: string, bytes: Uint8Array) {
  const kind = verifiedPreview(mime, bytes);
  if (kind !== "none") return { kind, mime };
  if (mime === "image/avif" && safeInlineNoteMedia(mime, bytes))
    return { kind: "image" as const, mime };
  if (
    bytes.length <= 512 * 1024 &&
    (/^(text\/plain|text\/markdown|application\/json)$/.test(mime) ||
      /\.(txt|md|log|json|csv|ya?ml|ini|conf)$/i.test(name)) &&
    !bytes.includes(0)
  )
    return { kind: "text" as const, mime: "text/plain" };
  return { kind: "none" as const, mime: "application/octet-stream" };
}
