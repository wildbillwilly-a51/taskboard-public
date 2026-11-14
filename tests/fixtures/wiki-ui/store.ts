// Copied to src/lib/wiki-store.ts ONLY inside the external fixture app.
import { cookies } from "next/headers";
import { fixtureNote, fixtureSpace, type Scenario } from "./state";
import { NotesNotFoundError } from "@/lib/notes-errors";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import type { WikiPageListInput } from "@/lib/wiki-model";
import { buildWikiPageHref } from "@/lib/wiki-model";
async function scenario() { return ((await cookies()).get("wikiScenario")?.value ?? "manager") as Scenario; }
export async function listWikiSpaces(_user: TaskboardUserIdentity, _input?: { includeArchived?: boolean }) { void _user; void _input; return [fixtureSpace(await scenario())]; }
export async function getWikiSpace(_user: TaskboardUserIdentity, _input: { slug?: string; spaceId?: string }) { void _user; void _input; return fixtureSpace(await scenario()); }
export async function getWikiPage(_user: TaskboardUserIdentity, id: string) {
  void _user;
  if (await scenario() === "missing") throw new NotesNotFoundError("Unavailable");
  let note = fixtureNote(await scenario());
  const state = (await cookies()).get("wikiState")?.value;
  if (state) {
    const update = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    note = { ...note, title: update.title, displayTitle: update.title || "Untitled note", contentVersion: update.contentVersion, content: update.content, contentMarkdown: update.contentMarkdown, deletedAt: update.deletedAt, wiki: { ...note.wiki, spaceId: update.spaceId, spaceSlug: update.spaceSlug, canonicalHref: buildWikiPageHref(update.spaceSlug, note.id, update.title) } };
  }
  if (id !== note.id) throw new NotesNotFoundError("Unavailable"); return note;
}
export async function listWikiPages(_user: TaskboardUserIdentity, _input?: WikiPageListInput) { void _user; if (_input?.topicId && !["70000000-0000-4000-8000-000000000001", "70000000-0000-4000-8000-000000000002", "70000000-0000-4000-8000-000000000003"].includes(_input.topicId)) throw new NotesNotFoundError("Topic unavailable"); return { pages: [fixtureNote(await scenario())], limit: 100, offset: 0, hasMore: false }; }
