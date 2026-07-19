import { jsonResponse, requireAuth } from "../_shared/utils.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  const row = await env.DB.prepare("SELECT data FROM active_war WHERE id = 1").first();
  if (!row) {
    return jsonResponse(null);
  }

  return jsonResponse(JSON.parse(row.data));
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ success: false, message: "Invalid request." }, 400);
  }

  await env.DB.prepare("INSERT OR REPLACE INTO active_war (id, data) VALUES (1, ?)")
    .bind(JSON.stringify(body))
    .run();

  return jsonResponse({ success: true });
}
