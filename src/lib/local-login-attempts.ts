import "server-only";

const attempts = new Map<string, { count: number; expires: number }>();
const maxAttempts = 10;

export function admitLocalLogin(userId: string) {
  const now = Date.now();
  const current = attempts.get(userId);
  if (current && current.expires > now) {
    if (current.count >= maxAttempts) return false;
    current.count += 1;
    return true;
  }
  if (attempts.size >= 2048) {
    for (const [id, entry] of attempts) if (entry.expires <= now) attempts.delete(id);
    if (attempts.size >= 2048) return false;
  }
  attempts.set(userId, { count: 1, expires: now + 60_000 });
  return true;
}

export function clearLocalLoginAttempts(userId: string) {
  attempts.delete(userId);
}
