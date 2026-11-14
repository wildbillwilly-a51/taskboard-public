// Publish a structural subset of BlockNote, never arbitrary persisted block props.
const blocks = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "table", "toggleListItem"]);
const textStyles = new Set(["bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor"]);
const props = new Set(["textAlignment", "textColor", "backgroundColor", "level", "language", "checked", "start"]);
const unavailableText = "This content cannot be displayed in the shared view.";

// One wire-size budget for every public body field, including plain-text logs.
// Each caller retains its record and renders an explicit fallback, not a slice.
export function createPublicContentBudget(totalBytes = 2 * 1024 * 1024, eachBytes = 262144) {
    let remaining = totalBytes;
    const accepts = (value: unknown) => {
        const size = Buffer.byteLength(JSON.stringify(value));
        if (size > eachBytes || size > remaining)
            return false;
        remaining -= size;
        return true;
    };
    return {
        text(value: unknown) {
            return typeof value === "string" && accepts(value) ? value : unavailableText;
        },
        document(value: unknown, resolve: (url: string, media: boolean) => string | null): unknown[] {
            try {
                if (!Array.isArray(value))
                    throw new Error("Unsupported document.");
                const content = sanitizeSharedNoteContent(value, resolve);
                if (accepts(content))
                    return content;
            }
            catch { /* Keep the rest of the workspace available. */ }
            return [{ type: "paragraph", content: [{ type: "text", text: unavailableText, styles: {} }] }];
        },
    };
}
function cleanProps(value: Record<string, unknown>, tableCell = false) {
    return Object.fromEntries(Object.entries(value).filter(([key, val]) => {
        if (tableCell && ["colspan", "rowspan"].includes(key))
            return Number.isInteger(val) && Number(val) > 0 && Number(val) <= 100;
        if (!props.has(key))
            return false;
        if (key === "level")
            return Number.isInteger(val) && Number(val) >= 1 && Number(val) <= 6;
        if (key === "checked")
            return typeof val === "boolean";
        if (key === "start")
            return Number.isInteger(val) && Number(val) >= 0;
        if (key === "textAlignment")
            return ["left", "center", "right", "justify"].includes(String(val));
        return typeof val === "string" && val.length <= 100;
    }));
}
export function sanitizeSharedNoteContent(value: unknown, resolveUrl: (url: string, media: boolean) => string | null): unknown[] {
    let count = 0;
    function inline(value: unknown, depth: number): unknown[] {
        if (depth > 32)
            throw new Error("Note nesting is too deep.");
        if (!Array.isArray(value))
            return [];
        return value.flatMap((item): unknown[] => {
            if (!item || typeof item !== "object" || ++count > 10000)
                return [];
            const v = item as Record<string, unknown>;
            // Public payloads contain neither target IDs nor cached titles/hrefs,
            // including malformed mentions. No authenticated lookup is involved.
            if (v.type === "pageMention")
                return [{ type: "text", text: "Wiki page", styles: {} }];
            if (v.type === "text" && typeof v.text === "string")
                return [{ type: "text", text: v.text, styles: Object.fromEntries(Object.entries((v.styles && typeof v.styles === "object" ? v.styles : {}) as object).filter(([key, val]) => textStyles.has(key) && (typeof val === "boolean" || typeof val === "string"))) }];
            if (v.type === "link") {
                const content = inline(v.content, depth + 1);
                const href = typeof v.href === "string" ? resolveUrl(v.href, false) : null;
                return href ? [{ type: "link", href, content }] : content;
            }
            return [];
        });
    }
    function visit(value: unknown, depth: number): unknown[] {
        if (depth > 32)
            throw new Error("Note nesting is too deep.");
        if (!Array.isArray(value))
            return [];
        return value.flatMap((item): unknown[] => {
            if (!item || typeof item !== "object" || ++count > 10000)
                return [];
            const v = item as Record<string, unknown>, p = (v.props && typeof v.props === "object" ? v.props : {}) as Record<string, unknown>;
            const type = typeof v.type === "string" ? v.type : "paragraph";
            if (type === "pageMention")
                return [{ type: "paragraph", content: [{ type: "text", text: "Wiki page", styles: {} }] }];
            if (["image", "file", "audio", "video"].includes(type)) {
                const raw = typeof p.url === "string" ? p.url : "", url = resolveUrl(raw, true);
                const name = typeof p.name === "string" ? p.name : "Attachment";
                if (url && (type === "image" || type === "file"))
                    return [{ type, props: { url, name, caption: typeof p.caption === "string" ? p.caption : "", ...(typeof p.previewWidth === "number" ? { previewWidth: Math.min(1600, Math.max(50, p.previewWidth)) } : {}) }, children: visit(v.children, depth + 1) }];
                const href = resolveUrl(raw, false);
                return [{ type: "paragraph", content: href ? [{ type: "link", href, content: [{ type: "text", text: name, styles: {} }] }] : [{ type: "text", text: name, styles: {} }], children: visit(v.children, depth + 1) }];
            }
            let content: unknown = inline(v.content, depth + 1);
            if (type === "table" && v.content && typeof v.content === "object") {
                const t = v.content as Record<string, unknown>;
                if (!Array.isArray(t.rows) || !t.rows.length || t.rows.length > 500)
                    throw new Error("Unsupported table size.");
                const rows = t.rows.map(row => {
                    const cells = row && typeof row === "object" ? (row as {
                        cells?: unknown[];
                    }).cells : null;
                    if (!Array.isArray(cells) || !cells.length || cells.length > 100)
                        throw new Error("Unsupported table size.");
                    return { cells: cells.map(cell => {
                            if (Array.isArray(cell))
                                return inline(cell, depth + 1);
                            const c = cell && typeof cell === "object" ? cell as Record<string, unknown> : {};
                            return { type: "tableCell", content: inline(c.content, depth + 1), props: cleanProps(c.props && typeof c.props === "object" ? c.props as Record<string, unknown> : {}, true) };
                        }) };
                });
                content = { type: "tableContent", rows,
                    ...(Array.isArray(t.columnWidths) ? { columnWidths: t.columnWidths.map(width => typeof width === "number" && width > 0 && width <= 4000 ? width : undefined) } : {}),
                    ...(Number.isInteger(t.headerRows) && Number(t.headerRows) >= 0 && Number(t.headerRows) <= rows.length ? { headerRows: t.headerRows } : {}),
                    ...(Number.isInteger(t.headerCols) && Number(t.headerCols) >= 0 && Number(t.headerCols) <= 100 ? { headerCols: t.headerCols } : {}),
                };
            }
            if (type === "table" && (!content || Array.isArray(content)))
                throw new Error("Unsupported table content.");
            return [{ type: blocks.has(type) ? type : "paragraph", props: cleanProps(p), content, children: visit(v.children, depth + 1) }];
        });
    }
    const result = visit(value, 0);
    if (count > 10000)
        throw new Error("Note is too complex to publish.");
    return result;
}
export function verifiedPreview(mime: string, bytes?: Uint8Array): "image" | "pdf" | "none" {
    if (!bytes)
        return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime) ? "image" : mime === "application/pdf" ? "pdf" : "none";
    const b = Buffer.from(bytes.subarray(0, 12)), ascii = (start: number, end: number) => b.subarray(start, end).toString("ascii");
    if (mime === "application/pdf" && ascii(0, 5) === "%PDF-")
        return "pdf";
    if (mime === "image/png" && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return "image";
    if (mime === "image/jpeg" && b[0] === 255 && b[1] === 216 && b[2] === 255)
        return "image";
    if (mime === "image/gif" && ["GIF87a", "GIF89a"].includes(ascii(0, 6)))
        return "image";
    if (mime === "image/webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
        return "image";
    return "none";
}
