export function getLoginDestination(value: unknown) {
  const origin = "https://taskboard.invalid";
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      && !/[\\\u0000-\u001f\u007f]/.test(value) && value.length <= 2048) {
    const target = new URL(value, origin);
    if (target.origin === origin && !target.pathname.startsWith("//")) {
      return target.pathname + target.search + target.hash;
    }
  }
  return "/folio";
}
