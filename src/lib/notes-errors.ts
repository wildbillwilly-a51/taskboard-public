// Shared error identities: safe to import in clients, routes and pure tests.
export class NotesNotFoundError extends Error {
  status = 404;
  constructor(message = "Note not found.") { super(message); this.name = "NotesNotFoundError"; }
}

export class NoteConflictError extends Error {
  status = 409;
  constructor(public currentVersion: number) {
    super("This note changed since you opened it."); this.name = "NoteConflictError";
  }
}

export type WikiRuleCode =
  | "invalid_folio_feature" | "invalid_share" | "sharing_disabled" | "share_key_missing" | "share_read_only" | "share_size" | "share_rate" | "invalid_content" | "invalid_save" | "mutation_conflict" | "invalid_file" | "file_limit"
  | "invalid_folio_request" | "folio_connections_required" | "folio_space_action_required" | "folio_history_changed" | "folio_space_changed" | "note_format_unsupported"
  | "invalid_wiki_request" | "wiki_team_board_required" | "wiki_read_only"
  | "wiki_not_found" | "wiki_home_conflict" | "wiki_home_change_forbidden"
  | "wiki_space_exists" | "wiki_slug_exists" | "wiki_space_not_empty"
  | "wiki_topic_name_exists" | "wiki_topic_has_children" | "wiki_topics_conflict"
  | "wiki_format_unsupported" | "note_attachment_unavailable" | "wiki_temporarily_unavailable";

export class WikiRuleError extends Error {
  constructor(public code: WikiRuleCode, message: string, public status: number) {
    super(message); this.name = "WikiRuleError";
  }
}
