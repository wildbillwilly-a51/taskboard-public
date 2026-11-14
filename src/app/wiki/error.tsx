"use client";
import { wikiProductName } from "@/lib/wiki-labels";
import { WikiButton } from "@/components/wiki/wiki-controls";
export default function WikiError({ reset }: { reset: () => void }) { return <section className="wiki-message" role="alert"><h1>{wikiProductName} is temporarily unavailable</h1><p>Your unsaved text is kept in this tab.</p><WikiButton onClick={reset}>Try again</WikiButton></section>; }
