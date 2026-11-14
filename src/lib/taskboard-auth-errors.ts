// Narrow typed boundary; retain messages used by legacy auth consumers.
export class TaskboardAuthenticationError extends Error {
  readonly status: 401 | 403;
  constructor(public code: "authentication_required" | "account_disabled", message: string) {
    super(message); this.name = "TaskboardAuthenticationError";
    this.status = code === "authentication_required" ? 401 : 403;
  }
}
