-- Per-user, per-species current attack/defense/healing. Starts at the CSV
-- base values and grows via random level-up boosts (see
-- functions/_shared/leveling.js); rows are created lazily (first unlock or
-- first level-up), not seeded up front.
CREATE TABLE animal_stats (
  username TEXT NOT NULL,
  species TEXT NOT NULL,
  attack INTEGER NOT NULL,
  defense INTEGER NOT NULL,
  healing INTEGER NOT NULL,
  PRIMARY KEY (username, species)
);
