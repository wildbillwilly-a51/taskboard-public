import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady } from "../src/lib/taskboard-store";
import {
  createFolioNote,
  getFolioLibrary,
  changeFolioConnection,
  folioHistory,
  drainFolioFileCleanup,
} from "../src/lib/folio-store";
import {
  getNote,
  updateNote,
  getNoteAttachmentDownload,
  createNote,
} from "../src/lib/notes-store";
import {
  discoverFolio,
  recordFolioView,
  setFolioFeatures,
  resolveFolioMentions,
} from "../src/lib/folio-discovery-store";
import {
  manageFolioShares,
  readSharedFolio,
  saveSharedFolio,
  uploadSharedFolioFile,
  removeSharedFolioFile,
  readSharedFolioFile,
  withSharedFolioUpload,
} from "../src/lib/folio-share-store";
import { createTemplateNote } from "../src/lib/folio-template-store";
import { safeFilePreview } from "../src/lib/folio-file-preview";
import type { Actor } from "../src/lib/notes-store-context";
import type { NoteContentInput } from "../src/lib/notes-model";

test(
  "Folio discovery and capability sharing preserve content and access boundaries",
  { skip: process.env.FOLIO_FEATURE_DB_TEST !== "1", timeout: 120000 },
  async (t) => {
    assert.match(
      process.env.DATABASE_URL ?? "",
      /@127\.0\.0\.1:55433\/taskboard_visual_test_folio_features_20261106$/,
    );
    await ensureDatabaseReady();
    const pool = getPool()!;
    const actors: Actor[] = ["Owner", "Other", "Administrator"].map((name) => ({
      id: randomUUID(),
      email: `${randomUUID()}@example.invalid`,
      displayName: `Feature ${name}`,
      authMode: "password",
      role: name === "Administrator" ? "admin" : "standard",
    }));
    const [owner, other, admin] = actors;
    const made: string[] = [];
    const content = (text: string): NoteContentInput => ({
      formatVersion: 2,
      blocks: [
        {
          id: randomUUID(),
          type: "paragraph",
          content: [{ type: "text", text, styles: {} }],
        },
      ],
      text,
      markdown: text,
    });
    const create = async (title: string, body = content(title)) => {
      const n = await createFolioNote(owner, { title, content: body });
      made.push(n.id);
      return n;
    };
    try {
      for (const a of actors)
        await pool.query(
          "INSERT INTO users(id,email,display_name,role) VALUES($1,$2,$3,$4)",
          [a.id, a.email, a.displayName, a.role],
        );
      const root = (await getFolioLibrary(owner)).rootSpaceId,
        privateNote = await create("Secret feature procedure");
      await changeFolioConnection(owner, privateNote.id, root, true);
      await t.test(
        "Folio links resolve older Personal notes without exposing them to other users or administrators",
        async () => {
          const legacy = await createNote(owner, {
            title: "Private older Personal reference",
            content: {
              blocks: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Private older body" }],
                },
              ],
              markdown: "Private older body",
              text: "Private older body",
            },
          });
          made.push(legacy.id);
          assert.equal(legacy.folio, undefined);
          const resolved = (
            await resolveFolioMentions(owner, { noteIds: [legacy.id] })
          )[0];
          assert.equal(resolved.state, "readable");
          if (resolved.state === "readable")
            assert.equal(resolved.href, `/folio?note=${legacy.id}`);
          for (const viewer of [other, admin])
            assert.deepEqual(
              await resolveFolioMentions(viewer, { noteIds: [legacy.id] }),
              [{ noteId: legacy.id, state: "restricted" }],
            );
          const reference = await create("Older note link source", {
            formatVersion: 2,
            blocks: [
              {
                id: randomUUID(),
                type: "paragraph",
                content: [
                  { type: "pageMention", props: { noteId: legacy.id } },
                ],
              },
            ],
            markdown: "Reference",
            text: "Reference",
          });
          assert.equal(
            (await discoverFolio(owner, { backlinkTo: legacy.id })).notes[0]
              ?.id,
            reference.id,
          );
          await assert.rejects(() =>
            discoverFolio(other, { backlinkTo: legacy.id }),
          );
        },
      );
      const target = await create("Needle procedure"),
        source = await create("Reference source", {
          formatVersion: 2,
          blocks: [
            {
              id: randomUUID(),
              type: "paragraph",
              content: [{ type: "pageMention", props: { noteId: target.id } }],
            },
          ],
          text: "Reference",
          markdown: `[Needle](/folio?note=${target.id})`,
        });
      // Creating and subsequent saving both maintain links. Explicitly exercise save.
      assert.equal(
        (await discoverFolio(other, { backlinkTo: target.id })).notes[0]?.id,
        source.id,
      );
      await updateNote(owner, source.id, {
        content: source.content.length
          ? {
              blocks: source.content,
              formatVersion: 2,
              text: "Reference",
              markdown: "Reference",
            }
          : content("Reference"),
        expectedVersion: source.contentVersion,
      });
      await t.test(
        "private notes and backlink targets remain inaccessible to other users and admins",
        async () => {
          for (const a of [other, admin]) {
            assert.equal(
              (await discoverFolio(a, { q: "Secret feature" })).notes.length,
              0,
            );
            await assert.rejects(() =>
              discoverFolio(a, { backlinkTo: privateNote.id }),
            );
          }
          assert.equal(
            (await discoverFolio(owner, { q: "Secret feature" })).notes[0]?.id,
            privateNote.id,
          );
          assert.equal(
            (await discoverFolio(other, { backlinkTo: target.id })).notes[0]
              ?.id,
            source.id,
          );
          await changeFolioConnection(owner, source.id, root, true);
          assert.equal(
            (await discoverFolio(other, { backlinkTo: target.id })).notes
              .length,
            0,
          );
        },
      );
      await t.test(
        "title ranking, personal recent views, review reminders and templates",
        async () => {
          await create(
            "Other search result",
            content("The needle procedure is described here."),
          );
          const result = await discoverFolio(other, { q: "Needle procedure" });
          assert.equal(result.notes[0].id, target.id);
          await recordFolioView(owner, target.id);
          assert.equal(
            (await discoverFolio(owner, { recent: true })).notes[0].id,
            target.id,
          );
          assert.equal(
            (await discoverFolio(other, { recent: true })).notes.length,
            0,
          );
          await setFolioFeatures(owner, target.id, {
            maintainerId: owner.id,
            reviewDue: "2020-01-01",
            isTemplate: true,
          });
          assert.equal(
            (await discoverFolio(owner, { due: true })).notes.some(
              (n) => n.id === target.id,
            ),
            true,
          );
          assert.equal(
            (await discoverFolio(other, { due: true })).notes.some(
              (n) => n.id === target.id,
            ),
            false,
          );
          const copy = await createTemplateNote(owner, {
            sourceId: target.id,
            title: "Copied template",
            destination: root,
          });
          made.push(copy.id);
          assert.equal(copy.folio?.audience, "personal");
          await assert.rejects(() => getNote(other, copy.id));
        },
      );
      await t.test(
        "only the note owner manages links even when shared content is editable",
        async () => {
          await assert.rejects(() => manageFolioShares(other, target.id));
          await assert.rejects(() => manageFolioShares(admin, target.id));
          assert.equal((await getNote(other, target.id)).canEdit, true);
        },
      );
      let links = await manageFolioShares(owner, target.id, "create", "read");
      links = await manageFolioShares(owner, target.id, "create", "write");
      const ro = links.links
          .find((l) => l.mode === "read")!
          .url!.split("/")
          .at(-1)!,
        rw = links.links
          .find((l) => l.mode === "write")!
          .url!.split("/")
          .at(-1)!;
      const rich: NoteContentInput = {
        formatVersion: 2,
        blocks: [
          {
            id: randomUUID(),
            type: "heading",
            props: { level: 2 },
            content: [
              { type: "text", text: "Shared heading", styles: { bold: true } },
            ],
          },
          {
            id: randomUUID(),
            type: "table",
            content: {
              type: "tableContent",
              rows: [
                {
                  cells: [
                    [{ type: "text", text: "Name", styles: {} }],
                    [{ type: "text", text: "Phone", styles: {} }],
                  ],
                },
                {
                  cells: [
                    [{ type: "text", text: "Pat", styles: {} }],
                    [{ type: "text", text: "123", styles: {} }],
                  ],
                },
              ],
            },
          },
          {
            id: randomUUID(),
            type: "codeBlock",
            props: { language: "mermaid" },
            content: [
              { type: "text", text: "flowchart TD\n A-->B", styles: {} },
            ],
          },
        ],
        text: "Shared heading Name Phone Pat 123 flowchart TD A-->B",
        markdown: "## Shared heading\n\n```mermaid\nflowchart TD\n A-->B\n```",
      };
      await t.test(
        "RO denies writes; RW preserves block IDs/tables/diagrams and records anonymous provenance",
        async () => {
          const initial = await readSharedFolio(ro);
          assert.equal(initial.mode, "read");
          const body = {
            mutationId: randomUUID(),
            expectedVersion: initial.contentVersion,
            title: "Anonymous edit",
            content: rich,
          };
          await assert.rejects(() => saveSharedFolio(ro, body));
          const saved = await saveSharedFolio(rw, body);
          assert.deepEqual(saved.content, rich.blocks);
          assert.equal(
            (await folioHistory(owner, target.id)).versions[0].author,
            "Shared-link editor",
          );
          const replay = await saveSharedFolio(rw, body);
          assert.equal(replay.contentVersion, saved.contentVersion);
          await assert.rejects(() =>
            saveSharedFolio(rw, { ...body, title: "Changed replay" }),
          );
          await assert.rejects(() =>
            saveSharedFolio(rw, { ...body, mutationId: randomUUID() }),
          );
          const signed = await updateNote(owner, target.id, {
            title: "Signed edit",
            expectedVersion: saved.contentVersion,
          });
          await assert.rejects(
            () => saveSharedFolio(rw, body),
            (e: unknown) => (e as { status: number }).status === 409,
          );
          assert.equal(
            (await readSharedFolio(rw)).title,
            "Signed edit",
            "divergent retry cannot silently rebase stale content",
          );
          assert.equal(signed.updatedByDisplayName, owner.displayName);
          assert.equal(
            (await folioHistory(owner, target.id)).versions[0].author,
            owner.displayName,
          );
        },
      );
      await t.test(
        "anonymous uploads stay owned by this note and removal is soft with history preserved",
        async () => {
          const initial = await readSharedFolio(rw);
          const uploaded = await uploadSharedFolioFile(
            rw,
            {
              name: "fixture.txt",
              type: "text/plain",
              bytes: Buffer.from("preview text"),
            },
            initial.contentVersion,
          );
          const f = uploaded.attachments.at(-1)!;
          const copied = await createTemplateNote(owner, {
            sourceId: target.id,
            title: "Independent file template",
            destination: root,
          });
          made.push(copied.id);
          const copiedFile = copied.attachments[0];
          assert.ok(copiedFile && copiedFile.id !== f.id);
          assert.equal(copied.features?.linkSharing, false);
          assert.equal(copied.features?.isTemplate, false);
          assert.equal(
            (await readSharedFolioFile(ro, f.id)).bytes.toString(),
            "preview text",
          );
          await assert.rejects(() => readSharedFolioFile(ro, randomUUID()));
          await updateNote(owner, target.id, {
            title: "Concurrent file editor",
            expectedVersion: uploaded.contentVersion,
          });
          await assert.rejects(
            () => removeSharedFolioFile(rw, f.id, uploaded.contentVersion),
            (e: unknown) => (e as { status: number }).status === 409,
          );
          await assert.rejects(
            () =>
              uploadSharedFolioFile(
                rw,
                {
                  name: "stale.txt",
                  type: "text/plain",
                  bytes: Buffer.from("stale"),
                },
                uploaded.contentVersion,
              ),
            (e: unknown) => (e as { status: number }).status === 409,
          );
          const latest = await readSharedFolio(rw);
          assert.equal(
            latest.attachments.length,
            uploaded.attachments.length,
            "stale file writes make no change",
          );
          const removed = await removeSharedFolioFile(
            rw,
            f.id,
            latest.contentVersion,
          );
          assert.equal(
            removed.attachments.some((x) => x.id === f.id),
            false,
          );
          await assert.rejects(() => readSharedFolioFile(ro, f.id));
          // Historical bytes still occupy storage. Removing files must not let
          // an anonymous visitor bypass the note's lifetime storage quota.
          await pool.query(
            "UPDATE note_attachments SET size_bytes=$2 WHERE id=$1",
            [f.id, 1024 ** 3],
          );
          await assert.rejects(
            () =>
              uploadSharedFolioFile(
                rw,
                {
                  name: "over-quota.txt",
                  type: "text/plain",
                  bytes: Buffer.from("x"),
                },
                removed.contentVersion,
              ),
            (e: unknown) => (e as { code: string }).code === "file_limit",
          );
          await pool.query(
            "UPDATE note_attachments SET size_bytes=12 WHERE id=$1",
            [f.id],
          );
          assert.equal(
            (
              await getNoteAttachmentDownload(owner, copied.id, copiedFile.id)
            ).content.toString(),
            "preview text",
            "template file remains independent after original removal",
          );
          assert.equal(
            (
              await pool.query(
                "SELECT removed_at IS NOT NULL removed FROM note_attachments WHERE id=$1",
                [f.id],
              )
            ).rows[0].removed,
            true,
          );
        },
      );
      await t.test(
        "public upload admission reserves bytes before parsing and bounds buffered requests",
        async () => {
          let release!: () => void,
            entered!: () => void,
            count = 0;
          const gate = new Promise<void>((resolve) => {
              release = resolve;
            }),
            both = new Promise<void>((resolve) => {
              entered = resolve;
            });
          const wait = async () => {
            if (++count === 2) entered();
            await gate;
          };
          const first = withSharedFolioUpload(rw, 26 * 1024 * 1024, wait),
            second = withSharedFolioUpload(rw, 26 * 1024 * 1024, wait);
          try {
            await both;
            await assert.rejects(
              () => withSharedFolioUpload(rw, 1, async () => {}),
              (e: unknown) => (e as { status: number }).status === 503,
            );
            const bytes = (
              await pool.query(
                "SELECT sum(bytes)::text bytes FROM folio_share_admissions a JOIN folio_note_shares s ON s.id=a.share_id WHERE s.note_id=$1",
                [target.id],
              )
            ).rows[0].bytes;
            assert.ok(
              Number(bytes) >= 52 * 1024 * 1024,
              "reservation is durable before parsing starts",
            );
          } finally {
            release();
            await Promise.all([first, second]);
          }
        },
      );
      await t.test(
        "public saves refuse management fields, active links, unknown schema and persisted bearer URLs",
        async () => {
          const n = await readSharedFolio(rw),
            body = {
              mutationId: randomUUID(),
              expectedVersion: n.contentVersion,
              title: n.title,
              content: rich,
            };
          await assert.rejects(() =>
            saveSharedFolio(rw, { ...body, connections: [] } as never),
          );
          for (const href of [
            "javascript:alert(1)",
            `/share/note/${rw}/files/${randomUUID()}`,
          ])
            await assert.rejects(() =>
              saveSharedFolio(rw, {
                ...body,
                content: {
                  ...rich,
                  blocks: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "link",
                          href,
                          content: [{ type: "text", text: "Bad", styles: {} }],
                        },
                      ],
                    },
                  ],
                },
              }),
            );
          await assert.rejects(() =>
            saveSharedFolio(rw, {
              ...body,
              content: {
                ...rich,
                blocks: [{ type: "inventedBlock", content: [] }],
              },
            }),
          );
        },
      );
      await t.test(
        "RO and RW revoke independently and regenerated links invalidate old capability",
        async () => {
          await manageFolioShares(owner, target.id, "disable", "write");
          await assert.rejects(() => readSharedFolio(rw));
          assert.equal((await readSharedFolio(ro)).mode, "read");
          const replaced = await manageFolioShares(
            owner,
            target.id,
            "regenerate",
            "read",
          );
          assert.notEqual(
            replaced.links
              .find((l) => l.mode === "read")!
              .url!.split("/")
              .at(-1),
            ro,
          );
          await assert.rejects(() => readSharedFolio(ro));
        },
      );
      await t.test(
        "preview policy rejects active formats and forged MIME signatures",
        () => {
          assert.equal(
            safeFilePreview(
              "attack.svg",
              "image/svg+xml",
              Buffer.from('<svg onload="alert(1)"/>'),
            ).kind,
            "none",
          );
          assert.equal(
            safeFilePreview(
              "fake.pdf",
              "application/pdf",
              Buffer.from("<html>"),
            ).kind,
            "none",
          );
          assert.equal(
            safeFilePreview("notes.txt", "text/plain", Buffer.from("<script>"))
              .kind,
            "text",
          );
        },
      );
    } finally {
      for (const id of made)
        await pool.query("DELETE FROM notes WHERE id=$1", [id]);
      await pool.query(
        "DELETE FROM folio_spaces WHERE owner_user_id=ANY($1::uuid[])",
        [actors.map((a) => a.id)],
      );
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
        actors.map((a) => a.id),
      ]);
      await drainFolioFileCleanup();
      await pool.end();
    }
  },
);
