import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentTaskboardUser } from "@/lib/taskboard-request";
import { NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import { BoardAccessError } from "@/lib/board-access";

export async function wikiUser() {
  const user = await getCurrentTaskboardUser();
  if (!user || user.isDisabled) redirect("/login");
  return user;
}
export async function wikiLoad<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (error) {
    if (error instanceof NotesNotFoundError || ((error instanceof WikiRuleError || error instanceof BoardAccessError) && (error.status === 404 || error.status === 403))) notFound();
    throw error;
  }
}
