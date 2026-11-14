import { ensureSchemaAndSeed } from "../lib/taskboard-store";

async function main() {
  await ensureSchemaAndSeed();
  console.log("Taskboard database schema and seed are ready.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
