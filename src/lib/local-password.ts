import "server-only";

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scryptN = 16384;
const scryptR = 8;
const scryptP = 1;
const saltBytes = 32;
const keyBytes = 64;

export const minimumLocalAdminPasswordLength = 12;

async function deriveScryptKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) {
  return await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

export async function hashLocalPassword(password: string) {
  const salt = randomBytes(saltBytes);
  const derived = await deriveScryptKey(password, salt, keyBytes, {
    N: scryptN,
    r: scryptR,
    p: scryptP,
  });

  return [
    "scrypt",
    String(scryptN),
    String(scryptR),
    String(scryptP),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyLocalPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");

  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    salt.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }

  const actual = await deriveScryptKey(password, salt, expected.length, { N: n, r, p });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
