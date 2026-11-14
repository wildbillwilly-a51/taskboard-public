import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const boardSource = readFileSync("src/components/taskboard.tsx", "utf8");

test("notifications live in an always-mounted header bell that polls every five minutes", () => {
  assert.match(boardSource, /const NOTIFICATIONS_POLL_INTERVAL_MS = 5 \* 60_000;/);
  assert.match(boardSource, /\}, NOTIFICATIONS_POLL_INTERVAL_MS\);/);
  assert.match(boardSource, /data-testid="header-notifications-bell"/);
  assert.match(boardSource, /`Notifications, \$\{unreadNotificationCount\} unread`/);
  // Rendered in the header tools beside the Menu button, not inside the Menu.
  assert.match(
    boardSource,
    /\{!phoneViewport\.isPhone && persistenceEnabled && isPersonalActiveBoard \? \(\s*<NotificationsControl\s+persistenceEnabled\s+onOpenTask=\{handleSelectTask\}\s*\/>\s*\) : null\}\s*<div className="relative">\s*<button\s+ref=\{moreMenuButtonRef\}/,
  );
  assert.match(boardSource, /headerAction=\{phoneViewport\.isPhone && persistenceEnabled && isPersonalActiveBoard \? \(\s*<NotificationsControl/);
  assert.doesNotMatch(boardSource, /<NotificationsControl[^>]*triggerClassName=\{MENU_ROW_CLASS\}/);
});
