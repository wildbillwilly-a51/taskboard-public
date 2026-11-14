import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { BoardAccessError } from "@/lib/board-access";
import { NotesNotFoundError } from "@/lib/notes-errors";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { ensureDatabaseReady } from "@/lib/taskboard-store";
import { removeNoteAttachmentFiles } from "@/lib/note-attachments-store";
const discardClients=new WeakSet<PoolClient>();
export const ownedBoardNotes=new AsyncLocalStorage<{boardId:string;userId:string}>();
export const noteFileTransaction=new AsyncLocalStorage<{created:string[];removed:string[]}>();
// The caller has already locked and verified this exact personal board owner.
// Reuse native cores without widening their link/home scope to other boards.
export function withOwnedBoardNotes<T>(boardId:string,userId:string,run:()=>Promise<T>) { return ownedBoardNotes.run({boardId,userId},run); }

export type Actor = TaskboardUserIdentity & { id: string };
export function toIso(value: Date | string | null) {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function requireActor(user: TaskboardUserIdentity): Actor {
  if(ownedBoardNotes.getStore() && ownedBoardNotes.getStore()!.userId!==user.id)throw new NotesNotFoundError();
  if (!user.id || user.isDisabled) {
    throw new BoardAccessError("board_access_denied", "Sign in to use notes.", 403);
  }

  return user as Actor;
}

export async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  await ensureDatabaseReady();
  const pool = getPool();

  if (!pool) {
    throw new Error("Persistence is unavailable.");
  }

  const client = await pool.connect();

  try {
    return await callback(client);
  } finally {
    client.release(discardClients.has(client));
  }
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>,rollbackFiles?:()=>Promise<void>) {
  return withClient((client) => withTransactionOnClient(client, callback, rollbackFiles));
}

// Owns a transaction on an already acquired client. Never call inside another
// transaction; nested helpers receive the client directly instead.
export async function withTransactionOnClient<T>(client: PoolClient, callback: (client: PoolClient) => Promise<T>, rollbackFiles?:()=>Promise<void>) {
  const files={created:[] as string[],removed:[] as string[]};
  await client.query("BEGIN");
  let commitAttempted=false;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'");
    const result = await noteFileTransaction.run(files,()=>callback(client));
    commitAttempted=true;
    await client.query("COMMIT");
    await removeNoteAttachmentFiles(files.removed);
    return result;
  } catch (error) {
    if(commitAttempted)discardClients.add(client);
    try { await client.query("ROLLBACK"); } catch { discardClients.add(client); }
    if(!commitAttempted){try { await rollbackFiles?.(); } finally { await removeNoteAttachmentFiles(files.created); }}
    throw error;
  }
}

