self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    // Keep every push user-visible, including older or malformed payloads.
  }
  const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  const task = uuid.test(payload?.boardId) && uuid.test(payload?.taskId);
  const path = task
    ? "/?boardId=" + payload.boardId + "&taskId=" + payload.taskId
    : "/";
  event.waitUntil(self.registration.showNotification("Taskboard", {
    body: payload?.id === "test" ? "Test alert from Taskboard" : "You have a task reminder",
    tag: uuid.test(payload?.id) ? "taskboard-" + payload.id : "taskboard-test",
    icon: "/offline-notes/personal-192.png",
    data: { path },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  if (path !== "/" && !/^\/\?boardId=[\da-f-]{36}&taskId=[\da-f-]{36}$/i.test(path ?? "")) return;
  event.waitUntil((async () => {
    const target = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const exact = windows.find((client) => client.url === target);
    if (exact) return exact.focus();
    // A different board window can have an editor open with unsaved changes.
    return self.clients.openWindow(target);
  })());
});
