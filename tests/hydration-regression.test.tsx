import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamsPage } from "../src/components/teams-page";
import {
  formatDate,
  formatDateOnly,
  useDisplayTimeZone,
} from "../src/components/taskboard-date-format";

const teamUpdatedAt = "2026-07-03T13:14:00.000Z";

const currentUser = {
  id: "user-walt",
  email: "walt@example.test",
  displayName: "Demo Owner",
  role: "admin" as const,
};

const teams = [
  {
    id: "team-alpha",
    name: "Alpha Team",
    description: "Hydration regression fixture",
    actorRole: "manager" as const,
    memberCount: 2,
    archivedAt: null,
    canManage: true,
    canManageMembers: true,
    canView: true,
    personalBoardViewEnabled: false,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: teamUpdatedAt,
  },
];

test("teams updated timestamp SSR output is stable across host time zones", () => {
  const originalTimeZone = process.env.TZ;

  try {
    const renders = ["UTC", "America/Chicago"].map((timeZone) => {
      process.env.TZ = timeZone;

      return renderToStaticMarkup(
        <TeamsPage currentUser={currentUser} teams={teams} teamBoards={[]} />,
      );
    });

    assert.equal(renders[0], renders[1]);
    assert.match(renders[0] ?? "", /Updated Jul 3, 2026, 1:14 PM/);
    assert.doesNotMatch(renders[0] ?? "", /Updated Jul 3, 2026, 8:14 AM/);
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
});

test("teams date formatting keeps explicit locale and UTC timezone", () => {
  const source = readFileSync("src/components/teams-page.tsx", "utf8");

  assert.match(source, /Intl\.DateTimeFormat\("en-US",\s*\{/);
  assert.match(source, /timeZone:\s*"UTC"/);
  assert.doesNotMatch(source, /Intl\.DateTimeFormat\(undefined/);
});

test("taskboard DnD context keeps a stable hydration id", () => {
  const source = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(source, /<DndContext\s+id="taskboard-board-dnd"/);
});

function TaskDueLabel({ value }: { value: string }) {
  const displayTimeZone = useDisplayTimeZone();

  return <span>{formatDate(value, displayTimeZone)}</span>;
}

function normalizeSpaces(value: string) {
  return value.replace(/\s/g, " ");
}

test("taskboard dates render in UTC on the server regardless of host time zone", () => {
  const originalTimeZone = process.env.TZ;

  try {
    const renders = ["UTC", "America/Chicago"].map((timeZone) => {
      process.env.TZ = timeZone;

      return normalizeSpaces(renderToStaticMarkup(<TaskDueLabel value={teamUpdatedAt} />));
    });

    assert.equal(renders[0], renders[1]);
    assert.equal(renders[0], "<span>Jul 3, 1:14 PM</span>");
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
});

test("taskboard dates format timestamps in the viewer time zone", () => {
  assert.equal(normalizeSpaces(formatDate(teamUpdatedAt, "America/Chicago")), "Jul 3, 8:14 AM");
  assert.equal(normalizeSpaces(formatDate(teamUpdatedAt, "UTC")), "Jul 3, 1:14 PM");
  // An all-day task stored at Chicago local midnight stays on its calendar date.
  assert.equal(formatDateOnly("2026-10-05T05:00:00.000Z", "America/Chicago"), "Oct 5, 2026");
  // Date-only values keep their calendar date in every viewer time zone.
  assert.equal(formatDateOnly("2026-10-05", "America/Chicago"), "Oct 5, 2026");
  assert.equal(formatDateOnly("2026-10-05", "Pacific/Auckland"), "Oct 5, 2026");
  assert.equal(formatDate("not a date", "UTC"), "Invalid date");
  // Database timestamps can reach the client as Date objects despite string types.
  assert.equal(
    normalizeSpaces(formatDate(new Date(teamUpdatedAt) as unknown as string, "America/Chicago")),
    "Jul 3, 8:14 AM",
  );
});

test("visual console monitor catches known hydration mismatch signatures", () => {
  const source = readFileSync("tests/visual/layout-regression.spec.ts", "utf8");

  assert.match(source, /DndDescribedBy/);
  assert.match(source, /Text content did not match/);
  assert.match(source, /Minified React error #418/);
});
