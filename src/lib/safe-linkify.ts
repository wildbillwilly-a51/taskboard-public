export type SafeLinkSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string; text: string };

const safeLinkPattern = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const simpleTrailingPunctuation = new Set([".", ",", ";", ":", "!", "?"]);
const closingPairs: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function countCharacter(value: string, character: string) {
  return [...value].filter((candidate) => candidate === character).length;
}

function splitTrailingPunctuation(value: string) {
  let linkText = value;
  let trailingText = "";

  while (linkText) {
    const lastCharacter = linkText.at(-1);

    if (!lastCharacter) {
      break;
    }

    if (simpleTrailingPunctuation.has(lastCharacter)) {
      trailingText = `${lastCharacter}${trailingText}`;
      linkText = linkText.slice(0, -1);
      continue;
    }

    const openingCharacter = closingPairs[lastCharacter];
    if (
      openingCharacter &&
      countCharacter(linkText, lastCharacter) > countCharacter(linkText, openingCharacter)
    ) {
      trailingText = `${lastCharacter}${trailingText}`;
      linkText = linkText.slice(0, -1);
      continue;
    }

    break;
  }

  return { linkText, trailingText };
}

function normalizeSafeHref(value: string) {
  const candidate = value.toLowerCase().startsWith("www.") ? `https://${value}` : value;

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function splitSafeLinks(text: string): SafeLinkSegment[] {
  const segments: SafeLinkSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(safeLinkPattern)) {
    const matchIndex = match.index ?? cursor;
    const matchedText = match[0];
    const { linkText, trailingText } = splitTrailingPunctuation(matchedText);
    const href = normalizeSafeHref(linkText);

    if (matchIndex > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, matchIndex) });
    }

    if (href) {
      segments.push({ kind: "link", href, text: linkText });
      if (trailingText) {
        segments.push({ kind: "text", text: trailingText });
      }
    } else {
      segments.push({ kind: "text", text: matchedText });
    }

    cursor = matchIndex + matchedText.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "text", text }];
}
