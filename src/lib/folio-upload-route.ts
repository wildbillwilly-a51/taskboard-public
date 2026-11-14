import "server-only";
import { WikiRuleError } from "./notes-errors";
// Limit bytes while reading, including chunked requests without Content-Length.
export async function boundedMultipart(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw new WikiRuleError("share_size", "The upload is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WikiRuleError("invalid_file", "Select a file.", 400);
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WikiRuleError("share_size", "The upload is too large.", 413);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  return new Response(body, {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}
