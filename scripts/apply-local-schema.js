// Cloudflare's local dev tooling has a known inconsistency: `wrangler d1
// execute --local` / `wrangler d1 migrations apply --local` and `wrangler
// pages dev` can resolve the *same* D1 database to two different local
// SQLite files under .wrangler/state. Rather than chase which one is "right"
// (it can depend on the wrangler version), this applies every not-yet-seen
// migration file directly to every local D1 sqlite file it finds. Run after
// adding a new migration file, then (re)start `wrangler pages dev`.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const D1_DIR = path.join(__dirname, "..", ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

if (!fs.existsSync(D1_DIR)) {
  console.log("No local D1 state yet — run `npx wrangler pages dev .` once first, then re-run this.");
  process.exit(0);
}

const dbFiles = fs.readdirSync(D1_DIR).filter(function (name) {
  return name.endsWith(".sqlite") && name !== "metadata.sqlite";
});

const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
  .filter(function (name) {
    return name.endsWith(".sql");
  })
  .sort();

dbFiles.forEach(function (dbFile) {
  const fullPath = path.join(D1_DIR, dbFile);
  const db = new DatabaseSync(fullPath);

  // Our own bookkeeping table (separate from wrangler's) so this script can
  // tell which individual migration files this specific local db file has
  // already seen, instead of an all-or-nothing "does `users` exist" guess.
  db.exec("CREATE TABLE IF NOT EXISTS _local_migrations_applied (name TEXT PRIMARY KEY)");

  migrationFiles.forEach(function (migrationFile) {
    const alreadyApplied = db.prepare(
      "SELECT name FROM _local_migrations_applied WHERE name = ?"
    ).get(migrationFile);

    if (alreadyApplied) {
      return;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
    try {
      db.exec(sql);
      console.log(dbFile + ": applied " + migrationFile);
    } catch (error) {
      // This file's tables/rows may already exist from before this script's
      // own bookkeeping table existed (e.g. applied via `wrangler d1
      // migrations apply --local` earlier) — treat "already exists"/"UNIQUE
      // constraint failed" as already-applied, but surface anything else.
      if (!/already exists|UNIQUE constraint failed/i.test(error.message)) {
        throw error;
      }
      console.log(dbFile + ": " + migrationFile + " already present, marking as applied.");
    }
    db.prepare("INSERT INTO _local_migrations_applied (name) VALUES (?)").run(migrationFile);
  });

  db.close();
});
