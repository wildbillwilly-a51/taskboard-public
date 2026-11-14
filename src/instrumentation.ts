export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" &&
      process.env.TASKBOARD_WEB_PUSH_ENABLED === "true") {
    const { startTaskPushWorker } = await import("@/lib/task-push-delivery");
    startTaskPushWorker();
  }
}
