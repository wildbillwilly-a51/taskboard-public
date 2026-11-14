"use client";

import { useEffect, useRef, useState } from "react";
import { COMPACT_SURFACE_BUTTON_CLASS, TASK_EDITOR_MUTED_TEXT_CLASS } from "@/components/taskboard-constants";
import {
  currentPushRegistration,
  deviceAlertRequest,
  preparePushRegistration,
  pushDeviceLabel,
  pushKeyBytes,
  type DeviceAlerts,
} from "@/lib/task-push-client";

export function TaskPushControls() {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [server, setServer] = useState<DeviceAlerts | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [support, setSupport] = useState<"checking" | "ready" | "install" | "blocked" | "unsupported">("checking");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const settings = await deviceAlertRequest<DeviceAlerts>();
        if (disposed) return;
        setServer(settings);
        if (!settings.publicKey) return;
        if (!("PushManager" in window) || !("Notification" in window) || !("serviceWorker" in navigator)) {
          const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
          setSupport(appleMobile ? "install" : "unsupported");
          return;
        }
        if (Notification.permission === "denied") {
          setSupport("blocked");
          return;
        }
        const worker = await preparePushRegistration();
        if (disposed) return;
        setRegistration(worker);
        setSupport("ready");
      } catch {
        if (!disposed) {
          setNotice("Unable to load device alerts.");
        }
      }
    }
    void load();
    return () => { disposed = true; };
  }, []);

  const active = server?.devices.find((device) => device.current);
  useEffect(() => {
    if (notice && document.activeElement === document.body) statusRef.current?.focus();
  }, [busy, notice]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to manage device alerts.");
    } finally {
      try {
        setServer(await deviceAlertRequest<DeviceAlerts>());
      } catch {
        // Keep any actionable message and existing device list.
      }
      setBusy(false);
    }
  };

  function enable() {
    if (!registration || !server?.publicKey) return;
    const applicationServerKey = pushKeyBytes(server.publicKey);
    // Subscribe in the click handler so Safari sees a user gesture.
    void run(async () => {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      try {
        await deviceAlertRequest({ action: "enable", subscription: subscription.toJSON(), label: pushDeviceLabel() });
      } catch (error) {
        await subscription.unsubscribe().catch(() => {});
        throw error;
      }
      setNotice("Alerts enabled on this device.");
    });
  }

  function remove(deviceId: string, current: boolean) {
    void run(async () => {
      await deviceAlertRequest({ action: "remove", deviceId });
      if (current) {
        const worker = await currentPushRegistration();
        await (await worker?.pushManager.getSubscription())?.unsubscribe();
      }
      setNotice("Device alerts turned off.");
    });
  }

  if (!server?.publicKey && !notice) return null;

  return (
    <section aria-label="Device alerts" className="mt-2 grid shrink-0 gap-1 border-b border-border/70 px-1 pb-2">
      <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
        {support === "install" ? "On iPhone or iPad, add Taskboard to your Home Screen and enable alerts there."
          : support === "blocked" ? "Allow Taskboard notifications in your browser or device settings."
          : support === "unsupported" ? "This browser cannot receive device alerts."
          : "Get scheduled reminders for timed personal tasks on this device."}
      </p>
      <div className="flex flex-wrap gap-1">
        {support === "ready" && !active ? (
          <button type="button" className={COMPACT_SURFACE_BUTTON_CLASS} disabled={busy} onClick={enable}>
            Enable alerts on this device
          </button>
        ) : null}
        {active && support === "ready" ? (
          <button type="button" className={COMPACT_SURFACE_BUTTON_CLASS} disabled={busy} onClick={() => void run(async () => {
            await deviceAlertRequest({ action: "test", deviceId: active.id });
            setNotice("Test alert sent.");
          })}>
            Send a test alert
          </button>
        ) : null}
      </div>
      {server?.devices.length ? (
        <ul className="pretty-scrollbar grid max-h-24 gap-1 overflow-auto">
          {server.devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-1">
              <span className={TASK_EDITOR_MUTED_TEXT_CLASS}>{device.current ? "This device" : device.label}</span>
              <button type="button" className={COMPACT_SURFACE_BUTTON_CLASS} disabled={busy}
                aria-label={`Turn off alerts on ${device.current ? "this device" : device.label}`}
                onClick={() => remove(device.id, device.current)}>
                Turn off
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p ref={statusRef} tabIndex={-1} className={TASK_EDITOR_MUTED_TEXT_CLASS} role="status">{notice}</p> : null}
    </section>
  );
}
