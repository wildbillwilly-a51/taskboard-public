// Parallel releases need distinct fixture databases. Keep the destructive
// preparation and DB-suite opt-ins restricted to local visual-test names.
export function visualDatabaseName() {
  const name = process.env.TASKBOARD_VISUAL_DATABASE_NAME ?? "taskboard_visual_test";
  if (!/^taskboard_visual_test(?:_[a-z0-9_]+)?$/.test(name) || name.length > 63) {
    throw new Error("Use taskboard_visual_test or a taskboard_visual_test_* database name.");
  }
  return name;
}

export function isLocalVisualDatabase(url: URL) {
  return ["postgres:", "postgresql:"].includes(url.protocol)
    && ["127.0.0.1", "localhost"].includes(url.hostname)
    && !url.search && !url.hash
    && url.pathname === `/${visualDatabaseName()}`;
}
