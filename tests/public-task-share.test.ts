import assert from "node:assert/strict";
import test from "node:test";
import { isPublicTaskSharePath } from "../src/lib/public-task-share-model";
import { createPublicContentBudget, sanitizeSharedNoteContent, verifiedPreview } from "../src/lib/public-task-share-content";
test("public namespace admits only share reads and scoped files", () => {
    const base = `/share/task/${"a".repeat(43)}`;
    assert.ok(isPublicTaskSharePath(base));
    assert.ok(isPublicTaskSharePath(base + "/data"));
    assert.ok(isPublicTaskSharePath(base + "/files/task/11111111-1111-1111-1111-111111111111"));
    for (const suffix of ["/edit", "/notes/private", "/files/other/11111111-1111-1111-1111-111111111111", "/data/extra", "/../api/board", "%2fdata"])
        assert.equal(isPublicTaskSharePath(base + suffix), false);
});
test("plain text and rich documents consume one bounded public content budget", () => {
    const budget = createPublicContentBudget(300, 200);
    assert.equal(budget.text("a".repeat(150)), "a".repeat(150));
    const content = budget.document([{ type: "paragraph", content: [{ type: "text", text: "b".repeat(150), styles: {} }] }], () => null);
    assert.match(JSON.stringify(content), /cannot be displayed/);
    assert.equal(budget.text("c".repeat(100)), "c".repeat(100));
    assert.match(budget.text("d".repeat(100)), /cannot be displayed/);
    assert.match(createPublicContentBudget().text("\u0000".repeat(50000)), /cannot be displayed/, "Wire escaping is included in the byte budget");
});
test("public note projection retains text and children while removing executable URLs and arbitrary metadata", () => {
    const resolve = (url: string) => url.startsWith("https://example.test/") ? url : null;
    const content = sanitizeSharedNoteContent([{ id: "private-block-id", type: "paragraph", ownerId: "private-owner", props: { textAlignment: "left", privateSecret: "hidden" }, content: [{ type: "text", text: "Keep this", styles: { bold: true, privateSecret: "hidden" } }, { type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "Click", styles: {} }] }], children: [{ type: "paragraph", content: [{ type: "text", text: "Nested", styles: {} }] }] }], resolve);
    const json = JSON.stringify(content);
    assert.match(json, /Keep this/);
    assert.match(json, /Nested/);
    assert.match(json, /Click/);
    assert.match(json, /"bold":true/);
    assert.doesNotMatch(json, /private|javascript|alert/);
});
test("remote media becomes a link and only explicitly resolved owned media can embed", () => {
    const content = sanitizeSharedNoteContent([{ type: "image", props: { url: "https://external.test/tracker.png", name: "External" } }, { type: "image", props: { url: "/api/notes/owned/attachments/owned", name: "Owned" } }], (url, media) => url.startsWith("/api/notes/owned/") ? "/share/task/token/files/note/owned" : media ? null : url);
    assert.equal((content[0] as {
        type: string;
    }).type, "paragraph");
    assert.equal((content[1] as {
        type: string;
    }).type, "image");
    assert.doesNotMatch(JSON.stringify(content), /"url":"https:\/\/external/);
});
test("claimed media MIME alone cannot authorize inline serving", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    for (const mime of ["image/png", "image/jpeg", "image/svg+xml", "text/html", "application/pdf"])
        assert.equal(verifiedPreview(mime, html), "none");
    assert.equal(verifiedPreview("application/pdf", Buffer.from("%PDF-1.4\n")), "pdf");
    assert.equal(verifiedPreview("image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image");
});
test("table formatting survives projection while invalid tables fail for per-note fallback", () => {
    const table = { type: "table", content: { type: "tableContent", columnWidths: [180], headerRows: 1, headerCols: 1, rows: [{ cells: [{ type: "tableCell", props: { textAlignment: "center", colspan: 1 }, content: [{ type: "text", text: "Header", styles: { bold: true } }] }] }] } };
    const json = JSON.stringify(sanitizeSharedNoteContent([table], () => null));
    assert.match(json, /"columnWidths":\[180\]/);
    assert.match(json, /"headerRows":1/);
    assert.match(json, /"textAlignment":"center"/);
    assert.match(json, /Header/);
    assert.throws(() => sanitizeSharedNoteContent([{ type: "table", content: { rows: [] } }], () => null), /table/);
});
