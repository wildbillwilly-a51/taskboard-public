"use client";
import type { FolioPerson } from "@/lib/folio-features-model";
import { initials } from "@/lib/folio-features-model";
import s from "./folio-features.module.css";
export function FolioPeople({ people = [] }: { people?: FolioPerson[] }) {
  if (!people.length) return null;
  const label = people.map((p) => `${p.name} (${p.role})`).join(", ");
  return (
    <span className={s.people} aria-label={label} title={label}>
      {people.slice(0, 3).map((p) => (
        <span className={s.avatar} key={p.id} title={`${p.name} · ${p.role}`}>
          {initials(p.name)}
        </span>
      ))}
      {people.length > 3 ? (
        <span className={s.avatar}>+{people.length - 3}</span>
      ) : null}
    </span>
  );
}
