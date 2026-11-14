export function isAccountEmail(value: string) {
  return value.length <= 254 && /^[^@\s\u0000-\u001f\u007f]+@[^@\s\u0000-\u001f\u007f]+$/.test(value);
}
