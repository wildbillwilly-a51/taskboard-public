import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTaskboardPublicOrigin, requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import { listPushDevices, registerPushDevice, removePushDevice, sendPushTest, taskPushDeviceCookie } from "@/lib/task-push-devices";
import { getPool } from "@/lib/db";
import { isPushDatabase, subscriptionSchema, taskPushConfig } from "@/lib/task-push-transport";

async function livePushConfig() {
  const config = taskPushConfig();
  const pool = config ? getPool() : null;
  return pool && await isPushDatabase(pool) ? config : null;
}

const deviceIdSchema = z.uuid();
const deviceAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), subscription: subscriptionSchema, label: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("remove"), deviceId: deviceIdSchema }),
  z.object({ action: z.literal("test"), deviceId: deviceIdSchema }),
]);

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function currentDevice(request: NextRequest) {
  return deviceIdSchema.safeParse(request.cookies.get(taskPushDeviceCookie)?.value).data;
}

function deviceCookie(response: NextResponse, id?: string) {
  response.cookies.set(taskPushDeviceCookie, id ?? "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: id ? 400 * 24 * 60 * 60 : 0,
  });
  return response;
}

function errorResponse(error: unknown) {
  if (error instanceof TaskboardAuthenticationError) {
    return json({ error: "Sign in to manage device alerts." }, error.status);
  }
  return json({ error: "Unable to manage device alerts." }, 503);
}

export async function GET(request: NextRequest) {
  try {
    const identity = await requireTaskboardUserFromHeaders(request);
    const config = await livePushConfig();
    if (!config) return json({ publicKey: null, devices: [] });
    const current = currentDevice(request);
    const devices = await listPushDevices(identity, current);
    const response = json({ publicKey: config.publicKey, devices });
    return current && !devices.some((device) => device.current) ? deviceCookie(response) : response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const origin = getTaskboardPublicOrigin({ headers: request.headers, fallbackOrigin: request.url });
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ error: "Open device alerts from Taskboard." }, 403);
  }

  try {
    const identity = await requireTaskboardUserFromHeaders(request);
    const raw = await request.text();
    if (raw.length > 8_192) return json({ error: "Invalid device request." }, 413);
    const parsed = deviceAction.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Invalid device request or unsupported browser." }, 400);
    const action = parsed.data;
    const current = currentDevice(request);

    if (action.action === "remove") {
      await removePushDevice(identity, action.deviceId);
      const response = json({ ok: true });
      return action.deviceId === current ? deviceCookie(response) : response;
    }

    const config = await livePushConfig();
    if (!config) return json({ error: "Device alerts are unavailable." }, 503);
    if (action.action === "enable") {
      const device = await registerPushDevice(identity, action.subscription, action.label, current);
      return device
        ? deviceCookie(json({ device }), device)
        : deviceCookie(json({ error: "This browser was linked to another account. Enable alerts again to use this account." }, 409));
    }
    if (action.deviceId !== current) return json({ error: "Test alerts are sent to this device." }, 400);
    const status = await sendPushTest(identity, current, config);
    if (status === 200) return json({ ok: true });
    if (status === 404) return deviceCookie(json({ error: "Enable alerts again to reconnect this device." }, status));
    return json({ error: status === 429 ? "Wait 30 seconds before sending another test." : "Unable to send the test alert." }, status);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid device request." }, 400);
    return errorResponse(error);
  }
}
