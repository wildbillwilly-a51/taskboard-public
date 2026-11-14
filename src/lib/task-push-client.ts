type Device = { id: string; label: string; current: boolean };
export type DeviceAlerts = { publicKey: string | null; devices: Device[] };

const endpoint = "/api/notifications/devices";
const workerPath = "/taskboard-push.js";

export async function deviceAlertRequest<T>(action?: object, signal = AbortSignal.timeout(8_000)): Promise<T> {
  const response = await fetch(endpoint, action ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
    signal,
  } : { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to manage device alerts.");
  return result;
}

export async function currentPushRegistration() {
  if (!("serviceWorker" in navigator)) return undefined;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.active?.scriptURL === new URL(workerPath, location.origin).href
    ? registration : undefined;
}

export async function preparePushRegistration() {
  const registration = await navigator.serviceWorker.register(workerPath);
  if (registration.active?.state === "activated") return registration;
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error("Unable to prepare notifications for this device.");
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("Notification setup timed out.")), 8_000);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      worker?.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (worker?.state === "activated") finish();
      if (worker?.state === "redundant") finish(new Error("Unable to prepare notifications for this device."));
    }
    worker.addEventListener("statechange", check);
    check();
  });
  return registration;
}

export function pushKeyBytes(key: string) {
  return Uint8Array.from(atob(key.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

export function pushDeviceLabel() {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/i.test(agent)) return "Android";
  if (/Windows/i.test(agent)) return "Windows browser";
  if (/Macintosh/i.test(agent)) return "Mac browser";
  return "Browser";
}

export async function disconnectPushOnLogout() {
  const registration = await currentPushRegistration();
  if (!registration) return;
  try {
    const signal = AbortSignal.timeout(2_000);
    const state = await deviceAlertRequest<DeviceAlerts>(undefined, signal);
    const device = state.devices.find((item) => item.current);
    if (device) await deviceAlertRequest({ action: "remove", deviceId: device.id }, signal);
  } finally {
    await (await registration.pushManager.getSubscription())?.unsubscribe();
  }
}
