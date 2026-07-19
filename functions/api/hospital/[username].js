import { jsonResponse, requireAuth } from "../../_shared/utils.js";

const HOSPITAL_DURATION_MS = 72 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env, params.username);
  if (!auth.ok) {
    return auth.response;
  }

  const cutoff = Date.now() - HOSPITAL_DURATION_MS;

  // Prune expired stays before reading, same lazy-expiry approach the
  // client used to do itself against localStorage.
  await env.DB.prepare("DELETE FROM hospital WHERE username = ? AND admitted_at < ?")
    .bind(params.username, cutoff)
    .run();

  const rows = await env.DB.prepare("SELECT species, admitted_at FROM hospital WHERE username = ?")
    .bind(params.username)
    .all();

  const hospital = rows.results.map(function (row) {
    return { species: row.species, admittedAt: row.admitted_at };
  });

  return jsonResponse(hospital);
}

// Admits a defeated animal and strips it out of whatever swarm it was in,
// same as the client used to do locally — now both happen in one D1 batch.
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

  const species = body.species;
  if (!species) {
    return jsonResponse({ success: false, message: "species is required." }, 400);
  }

  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO hospital (username, species, admitted_at) VALUES (?, ?, ?)")
      .bind(params.username, species, Date.now()),
    env.DB.prepare("DELETE FROM swarms WHERE username = ? AND species = ?")
      .bind(params.username, species),
  ]);

  return jsonResponse({ success: true });
}
