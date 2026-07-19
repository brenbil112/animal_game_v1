import { hashPin, jsonResponse } from "../_shared/utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ success: false, message: "Invalid request." }, 400);
  }

  const username = (body.username || "").trim().toLowerCase();
  const pin = (body.pin || "").trim();

  if (!username || !pin) {
    return jsonResponse({ success: false, message: "Username and PIN are required." }, 400);
  }

  const row = await env.DB.prepare("SELECT pin_hash, salt FROM users WHERE username = ?")
    .bind(username)
    .first();

  if (!row) {
    return jsonResponse({ success: false, message: "Invalid login." }, 401);
  }

  const computedHash = await hashPin(pin, row.salt);
  if (computedHash !== row.pin_hash) {
    return jsonResponse({ success: false, message: "Invalid login." }, 401);
  }

  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)")
    .bind(token, username, Date.now())
    .run();

  return jsonResponse({ success: true, username: username, token: token });
}
