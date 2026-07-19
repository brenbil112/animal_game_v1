import { jsonResponse, requireAuth } from "../../_shared/utils.js";

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env, params.username);
  if (!auth.ok) {
    return auth.response;
  }

  const rows = await env.DB.prepare("SELECT swarm_number, species FROM swarms WHERE username = ?")
    .bind(params.username)
    .all();

  const swarms = { "1": [], "2": [], "3": [] };
  rows.results.forEach(function (row) {
    swarms[String(row.swarm_number)].push(row.species);
  });

  return jsonResponse(swarms);
}

// Replaces one swarm slot wholesale: body is { swarmNumber, species: [...] }.
export async function onRequestPut(context) {
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

  const swarmNumber = String(body.swarmNumber);
  const species = Array.isArray(body.species) ? body.species : [];

  if (!["1", "2", "3"].includes(swarmNumber)) {
    return jsonResponse({ success: false, message: "Invalid swarm number." }, 400);
  }

  const statements = [
    env.DB.prepare("DELETE FROM swarms WHERE username = ? AND swarm_number = ?")
      .bind(params.username, swarmNumber),
  ];

  species.forEach(function (oneSpecies) {
    statements.push(
      env.DB.prepare("INSERT INTO swarms (username, swarm_number, species) VALUES (?, ?, ?)")
        .bind(params.username, swarmNumber, oneSpecies)
    );
  });

  try {
    await env.DB.batch(statements);
  } catch (error) {
    // PRIMARY KEY is (username, species) — this fires if a species is
    // already assigned to a different swarm for this user.
    return jsonResponse({ success: false, message: "One of these animals is already in another swarm." }, 409);
  }

  return jsonResponse({ success: true });
}
