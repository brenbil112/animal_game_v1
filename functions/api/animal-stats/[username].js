import { jsonResponse, requireAuth } from "../../_shared/utils.js";
import { loadAnimalsData } from "../../_shared/animals-data.js";
import { levelForSightings, growStats } from "../../_shared/leveling.js";

// Returns { species: {attack, defense, healing} } for every species the
// user has unlocked. Any unlocked species missing an animal_stats row (a
// fresh unlock, or one that predates this feature and already has real
// sightings) gets lazily backfilled here from its current level, the same
// "prune/backfill on read" pattern the hospital endpoint uses.
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env, params.username);
  if (!auth.ok) {
    return auth.response;
  }

  const username = params.username;

  const unlockedRows = await env.DB.prepare(
    "SELECT species FROM unlocked_animals WHERE username = ?"
  ).bind(username).all();
  const unlockedSpecies = unlockedRows.results.map(function (row) {
    return row.species;
  });

  if (unlockedSpecies.length === 0) {
    return jsonResponse({});
  }

  const placeholders = unlockedSpecies.map(function () {
    return "?";
  }).join(",");

  const [statsRows, countRows, animalsData] = await Promise.all([
    env.DB.prepare("SELECT species, attack, defense, healing FROM animal_stats WHERE username = ? AND species IN (" + placeholders + ")")
      .bind(username, ...unlockedSpecies).all(),
    env.DB.prepare("SELECT species, count FROM sighting_counts WHERE username = ? AND species IN (" + placeholders + ")")
      .bind(username, ...unlockedSpecies).all(),
    loadAnimalsData(env),
  ]);

  const stats = {};
  statsRows.results.forEach(function (row) {
    stats[row.species] = { attack: row.attack, defense: row.defense, healing: row.healing };
  });

  const counts = {};
  countRows.results.forEach(function (row) {
    counts[row.species] = row.count;
  });

  const backfillStatements = [];

  unlockedSpecies.forEach(function (species) {
    if (stats[species]) {
      return;
    }
    const info = animalsData[species];
    if (!info) {
      return;
    }

    const sightings = counts[species] || 0;
    const level = levelForSightings(sightings, info.rarity);
    const baseStats = { attack: info.attack, defense: info.defense, healing: info.healing };
    const currentStats = level === null ? baseStats : growStats(baseStats, info.rarity, 1, level);

    stats[species] = currentStats;
    backfillStatements.push(
      env.DB.prepare(
        "INSERT INTO animal_stats (username, species, attack, defense, healing) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (username, species) DO NOTHING"
      ).bind(username, species, currentStats.attack, currentStats.defense, currentStats.healing)
    );
  });

  if (backfillStatements.length > 0) {
    await env.DB.batch(backfillStatements);
  }

  return jsonResponse(stats);
}
