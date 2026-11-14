import { redirect, notFound } from "next/navigation";
import { parseWikiPageId } from "@/lib/wiki-model";
export default async function WikiNoteAlias({params}:{params:Promise<{page:string}>}) {
  const id=parseWikiPageId((await params).page);if(!id)notFound();redirect(`/folio?note=${id}`);
}
