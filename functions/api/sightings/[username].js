import { jsonResponse, requireAuth, todayDateString } from "../../_shared/utils.js";

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

  const now = Date.now();
  const newlyUnlocked = [];
  const statements = [];

  speciesList.forEach(function (species) {
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
  });

  await env.DB.batch(statements);

  return jsonResponse({ success: true, newlyUnlocked: newlyUnlocked });
}
