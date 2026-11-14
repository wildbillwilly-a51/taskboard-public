import { wikiLabels } from "@/lib/wiki-labels";
import Link from "next/link";
export default function Missing() { return <section className="wiki-message"><h1>Page unavailable</h1><p>This address is unavailable or you no longer have access.</p><Link href="/wiki">{wikiLabels.back}</Link></section>; }
