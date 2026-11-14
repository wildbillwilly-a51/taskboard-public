import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { deleteTask, getBoardStateFromDatabase, updateTask } from "@/lib/taskboard-store";
import type { TaskIcon, TaskRecurrenceRule, TaskStatus } from "@/lib/taskboard-data";
import { OutagePeopleError } from "@/lib/outage-people";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    boardId?: string;
    title?: string;
    summary?: string;
    nextAction?: string;
    note?: string;
    status?: TaskStatus;
    startAt?: string | null;
    endAt?: string | null;
    allDay?: boolean;
    dueAt?: string | null;
    recurrence?: TaskRecurrenceRule | null;
    reminderOffsetMinutes?: number | null;
    overdueReminderEnabled?: boolean;
    labels?: string[];
    convertToTask?: boolean;
    color?: string;
    icon?: TaskIcon;
    bucketId?: string;
    promoteToMaintenanceOutage?: boolean;
    maintenanceOutage?: {
      locationId?: string | null;
      owner?: string;
      attendees?: string[];
      attendeeChanges?: { name: string; attending: boolean }[];
    };
  };
  const boardContext = getBoardContextFromRequest(request, body);

  if (
    typeof body.title !== "string" &&
    typeof body.summary !== "string" &&
    typeof body.nextAction !== "string" &&
    typeof body.note !== "string" &&
    typeof body.status !== "string" &&
    typeof body.startAt !== "string" &&
    body.startAt !== null &&
    typeof body.endAt !== "string" &&
    body.endAt !== null &&
    typeof body.allDay !== "boolean" &&
    typeof body.dueAt !== "string" &&
    body.dueAt !== null &&
    (body.recurrence !== null &&
      (typeof body.recurrence !== "object" || Array.isArray(body.recurrence))) &&
    typeof body.reminderOffsetMinutes !== "number" &&
    body.reminderOffsetMinutes !== null &&
    typeof body.overdueReminderEnabled !== "boolean" &&
    !Array.isArray(body.labels) &&
    body.convertToTask !== true &&
    typeof body.color !== "string" &&
    typeof body.icon !== "string" &&
    typeof body.bucketId !== "string"
    && body.promoteToMaintenanceOutage !== true
    && (typeof body.maintenanceOutage !== "object" || body.maintenanceOutage === null || Array.isArray(body.maintenanceOutage))
  ) {
    return NextResponse.json(
      { error: "Provide at least one supported task field." },
      { status: 400 },
    );
  }

  try {
    await updateTask(user, taskId, {
      ...(typeof body.title === "string" ? { title: body.title.trim() } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(typeof body.nextAction === "string" ? { nextAction: body.nextAction } : {}),
      ...(typeof body.note === "string" ? { note: body.note } : {}),
      ...(typeof body.status === "string" ? { status: body.status } : {}),
      ...(typeof body.startAt === "string" || body.startAt === null ? { startAt: body.startAt } : {}),
      ...(typeof body.endAt === "string" || body.endAt === null ? { endAt: body.endAt } : {}),
      ...(typeof body.allDay === "boolean" ? { allDay: body.allDay } : {}),
      ...(typeof body.dueAt === "string" || body.dueAt === null ? { dueAt: body.dueAt } : {}),
      ...("recurrence" in body ? { recurrence: body.recurrence ?? null } : {}),
      ...(typeof body.reminderOffsetMinutes === "number" || body.reminderOffsetMinutes === null
        ? { reminderOffsetMinutes: body.reminderOffsetMinutes ?? null }
        : {}),
      ...(typeof body.overdueReminderEnabled === "boolean"
        ? { overdueReminderEnabled: body.overdueReminderEnabled }
        : {}),
      ...(Array.isArray(body.labels)
        ? {
            labels: body.labels.map((label) => String(label).trim()).filter(Boolean),
          }
        : {}),
      ...(body.convertToTask === true ? { convertToTask: true } : {}),
      ...(typeof body.color === "string" ? { color: body.color } : {}),
      ...(typeof body.icon === "string" ? { icon: body.icon } : {}),
      ...(typeof body.bucketId === "string" ? { bucketId: body.bucketId.trim() } : {}),
      ...(body.promoteToMaintenanceOutage === true ? { promoteToMaintenanceOutage: true } : {}),
      ...(body.maintenanceOutage && typeof body.maintenanceOutage === "object" && !Array.isArray(body.maintenanceOutage)
        ? {
            maintenanceOutage: {
              ...(typeof body.maintenanceOutage.locationId === "string" || body.maintenanceOutage.locationId === null
                ? { locationId: body.maintenanceOutage.locationId }
                : {}),
              ...(typeof body.maintenanceOutage.owner === "string"
                ? { owner: body.maintenanceOutage.owner }
                : {}),
              ...(Array.isArray(body.maintenanceOutage.attendees)
                ? { attendees: body.maintenanceOutage.attendees.map((value) => String(value)) }
                : {}),
              ...(body.maintenanceOutage.attendeeChanges !== undefined
                ? { attendeeChanges: body.maintenanceOutage.attendeeChanges }
                : {}),
            },
          }
        : {}),
    }, boardContext, Object.keys(body).filter((key) => key !== "boardId"));

    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    if (error instanceof OutagePeopleError) return NextResponse.json({ error: error.message }, { status: error.status });
    return boardRouteErrorResponse(error, "Unable to update task.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);

  try {
    await deleteTask(user, taskId, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete task.");
  }
}
