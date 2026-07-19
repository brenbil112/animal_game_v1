-- Allowlist of accounts. pin_hash is SHA-256(salt + pin), never the raw PIN.
CREATE TABLE users (
  username TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);

-- One species can only ever be in one swarm slot for a given user — the
-- primary key enforces that exclusivity rule without extra application code.
CREATE TABLE swarms (
  username TEXT NOT NULL,
  swarm_number INTEGER NOT NULL,
  species TEXT NOT NULL,
  PRIMARY KEY (username, species)
);

CREATE TABLE hospital (
  username TEXT NOT NULL,
  species TEXT NOT NULL,
  admitted_at INTEGER NOT NULL,
  PRIMARY KEY (username, species)
);

-- Single source of truth for "is this unlocked" — seeded with the CSV
-- starters per user at account creation; sightings add more rows over time.
CREATE TABLE unlocked_animals (
  username TEXT NOT NULL,
  species TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (username, species)
);

CREATE TABLE sighting_counts (
  username TEXT NOT NULL,
  species TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, species)
);

CREATE TABLE daily_sightings (
  username TEXT NOT NULL,
  log_date TEXT NOT NULL,
  species TEXT NOT NULL,
  PRIMARY KEY (username, log_date, species)
);

-- The war/battle state stays one JSON blob rather than fully normalized —
-- it's deeply nested, always read/written wholesale by the client, and
-- there's only ever one active war right now.
CREATE TABLE active_war (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
