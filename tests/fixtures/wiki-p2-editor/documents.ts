export const mentionId = "71000000-0000-4000-8000-000000000001";
export const secondId = "71000000-0000-4000-8000-000000000002";
export const sourceId = "71000000-0000-4000-8000-000000000003";
export const spaceId = "71000000-0000-4000-8000-000000000004";
export const mention = { type: "pageMention", props: { noteId: mentionId } };
export const defaults = [
  { id: "heading", type: "heading", props: { level: 2, isToggleable: true }, content: [{ type: "text", text: "Heading", styles: { bold: true } }], children: [] },
  { id: "code", type: "codeBlock", props: { language: "typescript" }, content: [{ type: "text", text: "const x = 1;", styles: {} }], children: [] },
  { id: "list", type: "bulletListItem", content: [{ type: "text", text: "List", styles: {} }], children: [{ id: "child", type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "Nested", styles: {} }] }] },
  { id: "table", type: "table", content: { type: "tableContent", columnWidths: [150, 180], rows: [{ cells: [[{ type: "text", text: "Array cell", styles: {} }], { type: "tableCell", props: { textAlignment: "right", colspan: 1, rowspan: 1 }, content: [{ type: "text", text: "Object cell", styles: { italic: true } }] }] }] } },
  { id: "file", type: "file", props: { url: "/api/notes/files/fixture", name: "fixture.txt" }, children: [] },
];
export const mentionDocument = [{ id: "p", type: "paragraph", content: [{ type: "text", text: "See ", styles: {} }, mention, { type: "text", text: " here", styles: {} }], children: [] }];
