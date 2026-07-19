import { jsonResponse, requireAuth } from "../../_shared/utils.js";

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(request, env, params.username);
  if (!auth.ok) {
    return auth.response;
  }

  const rows = await env.DB.prepare("SELECT species FROM unlocked_animals WHERE username = ?")
    .bind(params.username)
    .all();

  const species = rows.results.map(function (row) {
    return row.species;
  });

  return jsonResponse(species);
}
