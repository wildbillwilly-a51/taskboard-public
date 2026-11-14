import { OptionsPage } from "@/components/options-page";
import { getSafeOptionsReturnTo } from "@/lib/options-return";

export default async function Options({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;

  return <OptionsPage returnTo={getSafeOptionsReturnTo(returnTo)} />;
}
