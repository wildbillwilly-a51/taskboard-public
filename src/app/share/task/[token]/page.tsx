import type { Metadata } from "next";
import { PublicTaskWorkspaceView } from "@/components/public-task-workspace";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared task workspace", robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
export default async function SharedTaskPage({ params }: {
    params: Promise<{
        token: string;
    }>;
}) {
    const { token } = await params;
    return <PublicTaskWorkspaceView key={token} token={token}/>;
}
