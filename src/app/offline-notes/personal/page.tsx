import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfflineNotes } from "@/components/notes/offline-notes";
import { isOfflineNotesBetaUser, isOfflineWorkBetaUser } from "@/lib/offline-notes-config";
import { getCurrentTaskboardUser } from "@/lib/taskboard-request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Offline Personal Notes | Taskboard",
  manifest: "/offline-notes/personal.webmanifest",
  appleWebApp: { capable: true, title: "Offline Notes" },
  icons: { apple: "/offline-notes/personal-192.png" },
  robots: { index: false, follow: false },
};

export default async function OfflineNotesPage() {
  const user = await getCurrentTaskboardUser();
  if (!isOfflineNotesBetaUser(user)) notFound();
  // The service worker caches this shell. Note data and account identity are
  // obtained independently from the authenticated, uncached Notes API.
  return <OfflineNotes workEnabled={isOfflineWorkBetaUser(user)} />;
}
