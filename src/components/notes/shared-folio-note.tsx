"use client";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { NoteContentInput, NoteAttachment } from "@/lib/notes-model";
import type { SharedFolioNote, PublicFolioSave } from "@/lib/folio-share-model";
import {
  canonicalNoteFileUrl,
  sharedNoteFileUrl,
} from "@/lib/folio-share-model";
import { FolioFilePreview } from "./folio-file-preview";
import s from "./folio-features.module.css";
import linen from "./notes-linen.module.css";
import folio from "./folio.module.css";
import { useConfirm } from "@/components/ui/confirm-dialog";
const Editor = dynamic(() => import("./note-editor"), {
  ssr: false,
  loading: () => <p>Loading note…</p>,
});
type Draft = { title: string; content: NoteContentInput };
export function SharedFolioNotePage({ token }: { token: string }) {
  const { confirm, dialog } = useConfirm();
  const [note, setNote] = useState<SharedFolioNote | null>(null),
    [draftTitle, setDraftTitle] = useState(""),
    [draftRevision, setDraftRevision] = useState(0),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0),
    [preview, setPreview] = useState<NoteAttachment | null>(null);
  const draft = useRef<Draft | null>(null),
    version = useRef(0),
    inFlight = useRef(false),
    changed = useRef(false),
    pending = useRef<PublicFolioSave | null>(null),
    current = useRef<SharedFolioNote | null>(null),
    titleInput = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const resizeTitle = useCallback(() => {
    const field = titleInput.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, []);
  useLayoutEffect(resizeTitle, [draftTitle, resizeTitle]);
  useEffect(() => {
    window.addEventListener("resize", resizeTitle);
    return () => window.removeEventListener("resize", resizeTitle);
  }, [resizeTitle]);
  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const r = await fetch(`/share/note/${token}/${path}`, {
        cache: "no-store",
        ...init,
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error ?? "This shared note is unavailable.");
      return v;
    },
    [token],
  );
  const receive = useCallback(
    (n: SharedFolioNote, reset = false, acceptedVersion = version.current) => {
      if (!reset && n.contentVersion !== acceptedVersion)
        throw Error(
          "This note changed elsewhere. Load the latest version before continuing.",
        );
      current.current = n;
      version.current = n.contentVersion;
      setNote(n);
      if (reset) {
        setDraftTitle(n.title);
        draft.current = {
          title: n.title,
          content: {
            blocks: n.content,
            markdown: n.contentMarkdown,
            text: "",
            formatVersion: n.contentFormatVersion,
          },
        };
        setEpoch((e) => e + 1);
      }
    },
    [],
  );
  useEffect(() => {
    let active = true;
    void request<SharedFolioNote>("data")
      .then((n) => {
        if (active) receive(n, true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [request, receive]);
  const save = useCallback(async () => {
    if (!draft.current || !changed.current || inFlight.current)
      return !inFlight.current;
    inFlight.current = true;
    setSaving(true);
    setError("");
    const outgoing = pending.current ?? {
      mutationId: crypto.randomUUID(),
      expectedVersion: version.current,
      ...draft.current,
    };
    pending.current = outgoing;
    try {
      const n = await request<SharedFolioNote>("save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outgoing),
      });
      pending.current = null;
      receive(n, false, outgoing.expectedVersion + 1);
      if (
        draft.current?.title === outgoing.title &&
        JSON.stringify(draft.current?.content) ===
          JSON.stringify(outgoing.content)
      ) {
        changed.current = false;
        setDirty(false);
      }
      return !changed.current;
    } catch (e) {
      setError(
        `${(e as Error).message} Your edits remain here. Retry the save, or copy your text before reloading.`,
      );
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [request, receive]);
  useEffect(() => {
    if (!dirty || error || saving) return;
    const t = setTimeout(() => void save(), 800);
    return () => clearTimeout(t);
  }, [dirty, draftRevision, saving, error, save]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (changed.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    const timer = setInterval(() => {
      if (changed.current || inFlight.current) return;
      void request<SharedFolioNote>("data")
        .then((n) => {
          if (
            !changed.current &&
            !inFlight.current &&
            (n.updatedAt !== current.current?.updatedAt ||
              n.contentVersion !== version.current)
          )
            receive(n, true);
        })
        .catch((e) => setError(e.message));
    }, 10000);
    return () => {
      window.removeEventListener("beforeunload", unload);
      clearInterval(timer);
    };
  }, [request, receive]);
  const update = (patch: Partial<Draft>) => {
    if (!draft.current) return;
    draft.current = { ...draft.current, ...patch };
    if (patch.title !== undefined) setDraftTitle(patch.title);
    setDraftRevision((r) => r + 1);
    changed.current = true;
    setDirty(true);
  };
  const upload = async (file: File) => {
    if (changed.current && !(await save()))
      throw Error("Save the pending text before attaching files.");
    const form = new FormData();
    form.append("files", file);
    form.append("expectedVersion", String(version.current));
    const n = await request<SharedFolioNote>("files", {
      method: "POST",
      body: form,
    });
    receive(n);
    const attachment = n.attachments.at(-1);
    if (!attachment) throw Error("No attachment was created.");
    return canonicalNoteFileUrl(n.id, attachment.id);
  };
  const remove = async (file: NoteAttachment) => {
    if (
      !(await confirm({
        title: `Remove “${file.originalName}” from this note?`,
        confirmLabel: "Remove attachment",
        tone: "danger",
      }))
    )
      return;
    if (changed.current && !(await save())) return;
    try {
      receive(
        await request<SharedFolioNote>(
          `files/${file.id}?expectedVersion=${version.current}`,
          {
            method: "DELETE",
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const resolveFileUrl = async (value: string) => {
    try {
      const u = new URL(value, location.origin),
        match = u.pathname.match(
          /^\/api\/notes\/([a-f0-9-]{36})\/attachments\/([a-f0-9-]{36})$/i,
        );
      if (u.origin === location.origin)
        return match &&
          match[1] === current.current?.id &&
          current.current.attachments.some((f) => f.id === match[2])
          ? sharedNoteFileUrl(token, match[2], true)
          : "";
      return ["https:", "http:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  if (!note)
    return (
      <main className={s.publicPage}>
        <h1>Shared note</h1>
        <p role={error ? "alert" : "status"}>{error || "Opening note…"}</p>
      </main>
    );
  return (
    <main className={`${s.publicPage} ${linen.root} ${folio.root}`}>
      <header>
        <span>
          Folio · {note.mode === "write" ? "Read/write link" : "Read-only link"}
        </span>
        <div className={s.row}>
          <span role="status">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
          </span>
          {note.mode === "write" ? (
            <button
              className="ui-button"
              disabled={saving}
              onClick={() => {
                if (editing && changed.current) {
                  void save().then((ok) => {
                    if (ok) setEditing(false);
                  });
                } else setEditing((e) => !e);
              }}
            >
              {editing ? "Read" : "Edit"}
            </button>
          ) : null}
        </div>
      </header>
      {error ? (
        <div role="alert" className={s.error}>
          {error}
          {dirty ? (
            <>
              <button className="ui-button" onClick={() => void save()}>
                Retry save
              </button>
              <button
                className="ui-button"
                onClick={() => {
                  const value = draft.current;
                  if (value)
                    void navigator.clipboard
                      .writeText(
                        `${value.title}\n\n${value.content.markdown || value.content.text}`,
                      )
                      .catch(() =>
                        setError(
                          "Select and copy your edits before reloading.",
                        ),
                      );
                }}
              >
                Copy my changes
              </button>
              <button
                className="ui-button"
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: "Discard your unsaved edits?",
                      body: "Copy your changes first if you want to keep them. This loads the latest version.",
                      confirmLabel: "Discard and reload",
                      tone: "danger",
                    }))
                  )
                    return;
                  void request<SharedFolioNote>("data")
                    .then((n) => {
                      pending.current = null;
                      changed.current = false;
                      setDirty(false);
                      setError("");
                      receive(n, true);
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                Load latest version
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <textarea
        ref={titleInput}
        rows={1}
        className={s.title}
        aria-label="Note title"
        readOnly={!editing}
        value={draftTitle}
        onChange={(e) => {
          update({ title: e.target.value });
        }}
        maxLength={300}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      <Editor
        key={`${note.id}:${epoch}`}
        initialBlocks={note.content}
        editable={editing && note.mode === "write"}
        contentFormatVersion={note.contentFormatVersion}
        onChange={(content) => update({ content })}
        uploadFile={upload}
        resolveFileUrl={resolveFileUrl}
      />
      <section className={s.files}>
        <h2>Attachments ({note.attachments.length})</h2>
        {note.attachments.map((f) => (
          <div className={s.file} key={f.id}>
            <a
              href={sharedNoteFileUrl(token, f.id)}
              download={f.originalName}
              rel="noreferrer"
            >
              {f.originalName}
              <small>{Math.max(1, Math.ceil(f.sizeBytes / 1024))} KB</small>
            </a>
            <button className="ui-button" onClick={() => setPreview(f)}>
              Preview
            </button>
            {editing ? (
              <button className="ui-button" onClick={() => void remove(f)}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {editing ? (
          <>
            <input
              ref={fileInput}
              hidden
              type="file"
              multiple
              onChange={(e) => {
                const files = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = "";
                void (async () => {
                  for (const file of files) await upload(file);
                })().catch((e) => setError(e.message));
              }}
            />
            <button
              className="ui-button"
              disabled={saving}
              onClick={() => fileInput.current?.click()}
            >
              Attach files
            </button>
            <small className={s.muted}>25 MB per file</small>
          </>
        ) : null}
      </section>
      {preview ? (
        <FolioFilePreview
          name={preview.originalName}
          baseUrl={sharedNoteFileUrl(token, preview.id, true)}
          downloadUrl={sharedNoteFileUrl(token, preview.id)}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {dialog}
    </main>
  );
}
