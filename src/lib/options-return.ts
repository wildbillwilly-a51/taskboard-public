const OPTIONS_RETURN_ORIGIN = "https://taskboard.local";
const ALLOWED_OPTIONS_RETURN_PATHS = new Set(["/", "/calendar", "/folio", "/notes"]);

export function buildOptionsHref(returnTo: string) {
  return `/options?returnTo=${encodeURIComponent(returnTo)}`;
}

export function getSafeOptionsReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  try {
    const target = new URL(candidate, OPTIONS_RETURN_ORIGIN);

    if (
      target.origin !== OPTIONS_RETURN_ORIGIN ||
      !(ALLOWED_OPTIONS_RETURN_PATHS.has(target.pathname) || target.pathname === "/wiki" || target.pathname.startsWith("/wiki/"))
    ) {
      return "/";
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
