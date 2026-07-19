import { jsonResponse, requireAuth, todayDateString } from "../../_shared/utils.js";
import { loadAnimalsData } from "../../_shared/animals-data.js";
import { levelForSightings, growStats } from "../../_shared/leveling.js";

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env, params.username);
  if (!auth.ok) {
    return auth.response;
  }

  const today = todayDateString();

  const loggedRows = await env.DB.prepare(
    "SELECT species FROM daily_sightings WHERE username = ? AND log_date = ?"
  ).bind(params.username, today).all();

  const countRows = await env.DB.prepare(
    "SELECT species, count FROM sighting_counts WHERE username = ?"
  ).bind(params.username).all();

  const counts = {};
  countRows.results.forEach(function (row) {
    counts[row.species] = row.count;
  });

  return jsonResponse({
    today: {
      date: today,
      loggedSpecies: loggedRows.results.map(function (row) {
        return row.species;
      }),
    },
    counts: counts,
  });
}

// Submits today's batch: increments lifetime counts, unlocks anything not
// already unlocked, and records today's log — all in one batch so a partial
// failure can't leave counts and the daily log disagreeing.
export async function onRequestPost(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env, params.username);
  if (!auth.ok) {
    return auth.response;
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ success: false, message: "Invalid request." }, 400);
  }

  const speciesList = Array.isArray(body.species) ? body.species : [];
  if (speciesList.length === 0) {
    return jsonResponse({ success: false, message: "No species submitted." }, 400);
  }

  const username = params.username;
  const today = todayDateString();

  const loggedRows = await env.DB.prepare(
    "SELECT species FROM daily_sightings WHERE username = ? AND log_date = ?"
  ).bind(username, today).all();

  if (loggedRows.results.length + speciesList.length > 3) {
    return jsonResponse({ success: false, message: "That would exceed today's limit of 3 sightings." }, 400);
  }

  const unlockedRows = await env.DB.prepare(
    "SELECT species FROM unlocked_animals WHERE username = ?"
  ).bind(username).all();
  const unlockedSet = new Set(unlockedRows.results.map(function (row) {
    return row.species;
  }));

  // speciesList entries are always distinct in practice (daily_sightings'
  // primary key forbids logging the same species twice in one day), but
  // dedupe defensively before batch-fetching old counts/stats by species.
  const uniqueSpecies = [...new Set(speciesList)];
  const placeholders = uniqueSpecies.map(function () {
    return "?";
  }).join(",");

  const [oldCountRows, existingStatsRows, animalsData] = await Promise.all([
    env.DB.prepare("SELECT species, count FROM sighting_counts WHERE username = ? AND species IN (" + placeholders + ")")
      .bind(username, ...uniqueSpecies).all(),
    env.DB.prepare("SELECT species, attack, defense, healing FROM animal_stats WHERE username = ? AND species IN (" + placeholders + ")")
      .bind(username, ...uniqueSpecies).all(),
    loadAnimalsData(env),
  ]);

  const oldCounts = {};
  oldCountRows.results.forEach(function (row) {
    oldCounts[row.species] = row.count;
  });

  const existingStats = {};
  existingStatsRows.results.forEach(function (row) {
    existingStats[row.species] = { attack: row.attack, defense: row.defense, healing: row.healing };
  });

  const now = Date.now();
  const newlyUnlocked = [];
  const levelUps = [];
  const statements = [];

  uniqueSpecies.forEach(function (species) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO sighting_counts (username, species, count) VALUES (?, ?, 1) " +
        "ON CONFLICT (username, species) DO UPDATE SET count = count + 1"
      ).bind(username, species)
    );

    statements.push(
      env.DB.prepare("INSERT INTO daily_sightings (username, log_date, species) VALUES (?, ?, ?)")
        .bind(username, today, species)
    );

    if (!unlockedSet.has(species)) {
      unlockedSet.add(species);
      newlyUnlocked.push(species);
      statements.push(
        env.DB.prepare("INSERT INTO unlocked_animals (username, species, unlocked_at) VALUES (?, ?, ?)")
          .bind(username, species, now)
      );
    }

    const info = animalsData[species];
    if (!info) {
      return;
    }

    const oldCount = oldCounts[species] || 0;
    const newCount = oldCount + 1;
    const oldLevel = levelForSightings(oldCount, info.rarity);
    const newLevel = levelForSightings(newCount, info.rarity);

    if (newLevel !== null && newLevel > oldLevel) {
      const baseStats = { attack: info.attack, defense: info.defense, healing: info.healing };
      // Backfill any levels this species already had before it had an
      // animal_stats row, then apply this submission's new level-up(s).
      const startingStats = existingStats[species] || growStats(baseStats, info.rarity, 1, oldLevel);
      const grownStats = growStats(startingStats, info.rarity, oldLevel, newLevel);

      statements.push(
        env.DB.prepare(
          "INSERT INTO animal_stats (username, species, attack, defense, healing) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (username, species) DO UPDATE SET attack = excluded.attack, defense = excluded.defense, healing = excluded.healing"
        ).bind(username, species, grownStats.attack, grownStats.defense, grownStats.healing)
      );

      levelUps.push({ species: species, oldLevel: oldLevel, newLevel: newLevel, stats: grownStats });
    }
  });

  await env.DB.batch(statements);

  return jsonResponse({ success: true, newlyUnlocked: newlyUnlocked, levelUps: levelUps });
}
