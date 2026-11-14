import { Fragment } from "react";

import { splitSafeLinks } from "@/lib/safe-linkify";

export function SafeLinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitSafeLinks(text).map((segment, index) => (
        <Fragment key={`${segment.kind}-${index}`}>
          {segment.kind === "link" ? (
            <a
              className="break-all font-medium text-[var(--color-accent)] underline decoration-current/40 underline-offset-2 hover:decoration-current"
              href={segment.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {segment.text}
            </a>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </>
  );
}
