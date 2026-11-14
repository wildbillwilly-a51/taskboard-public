import { SharedFolioNotePage } from "@/components/notes/shared-folio-note";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared note · Folio",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <SharedFolioNotePage token={(await params).token} />;
}
