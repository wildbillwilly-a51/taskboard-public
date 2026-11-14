import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool,PoolClient } from "pg";

// Observe PostgreSQL's actual lock graph, never infer blocking from a sleep.
export async function waitUntilBlocked(observer:Pool,holder:PoolClient,queryFragment="") {
  const pid=(holder as PoolClient & {processID:number}).processID;
  const deadline=Date.now()+3500;
  while(Date.now()<deadline) {
    const result=await observer.query<{pid:number;query:string}>("SELECT pid,query FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'",[pid]);
    if(result.rows.some(row=>row.query.includes(queryFragment)))return;
    await delay(15);
  }
  assert.fail(`Expected a database waiter blocked by ${pid} (${queryFragment}).`);
}
export async function transaction(client:PoolClient) {await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='8s'; SET LOCAL statement_timeout='12s'");}
