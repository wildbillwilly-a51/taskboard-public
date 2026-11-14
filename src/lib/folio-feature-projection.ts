import "server-only";
import type { PoolClient } from "pg";
import type { FolioFeatures, FolioPerson } from "./folio-features-model";
// Call only with note IDs whose access was established by the caller.
export async function folioFeatureProjection(
  client: PoolClient,
  ids: string[],
) {
  const result = new Map<string, FolioFeatures>();
  if (!ids.length) return result;
  const rows = (
    await client.query<{
      id: string;
      owner_user_id: string;
      owner_name: string;
      maintainer_user_id: string | null;
      maintainer_name: string | null;
      review_due: string | null;
      reviewed_at: Date | null;
      is_template: boolean | null;
      link_sharing: boolean;
      people: FolioPerson[];
    }>(
      `
 SELECT n.id,n.owner_user_id,coalesce(o.display_name,'Unknown') owner_name,f.maintainer_user_id,m.display_name maintainer_name,
 f.review_due::text,f.reviewed_at,f.is_template,EXISTS(SELECT 1 FROM folio_note_shares sh WHERE sh.note_id=n.id AND sh.revoked_at IS NULL) link_sharing,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'role',a.role) ORDER BY a.rank,a.last_at DESC)
 FROM (SELECT v.author_user_id::text id,coalesce(u.display_name,'Former contributor') name,'Contributor' role,1 rank,max(v.saved_at) last_at
 FROM note_versions v LEFT JOIN users u ON u.id=v.author_user_id WHERE v.note_id=n.id AND v.author_user_id IS NOT NULL AND v.author_user_id<>n.owner_user_id GROUP BY v.author_user_id,u.display_name
 UNION ALL SELECT 'shared-link','Shared-link editor','Shared-link editor',2,max(v.saved_at) FROM note_versions v WHERE v.note_id=n.id AND v.author_share_id IS NOT NULL HAVING count(*)>0) a),'[]'::jsonb) people
 FROM notes n LEFT JOIN users o ON o.id=n.owner_user_id LEFT JOIN folio_note_features f ON f.note_id=n.id LEFT JOIN users m ON m.id=f.maintainer_user_id WHERE n.id=ANY($1::uuid[])`,
      [ids],
    )
  ).rows;
  for (const r of rows)
    result.set(r.id, {
      people: [
        { id: r.owner_user_id, name: r.owner_name, role: "Owner" },
        ...r.people,
      ],
      maintainerId: r.maintainer_user_id,
      maintainerName: r.maintainer_name,
      reviewDue: r.review_due,
      reviewedAt: r.reviewed_at?.toISOString() ?? null,
      isTemplate: !!r.is_template,
      linkSharing: r.link_sharing,
    });
  return result;
}
