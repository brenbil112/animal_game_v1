// Shared helpers for every Pages Function. Files starting with "_" aren't
// treated as routes by Cloudflare Pages, so this is safe to import from.

// Pages Functions run on the Workers runtime (not Node.js), so PIN hashing
// uses the standard Web Crypto API. It produces the same SHA-256 hex digest
// as Node's crypto module (same algorithm, same encoding) — that's what lets
// scripts/seed-users.js (which runs under Node) and this (which runs in
// Workers) agree on the same hash for the same salt+pin.
export async function hashPin(pin, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashBytes = Array.from(new Uint8Array(hashBuffer));
  return hashBytes.map(function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

export function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function todayDateString() {
  const now = new Date();
  return now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
}

async function getSessionUsername(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return null;
  }

  const row = await env.DB.prepare("SELECT username FROM sessions WHERE token = ?")
    .bind(match[1])
    .first();
  return row ? row.username : null;
}

// Verifies the request's session token and, if expectedUsername is given,
// that the session actually belongs to that user — this is what stops a
// request from reading/writing another account's data just by editing the
// URL, since the PIN alone only guards the login step, not what comes after.
export async function requireAuth(request, env, expectedUsername) {
  const username = await getSessionUsername(request, env);

  if (!username) {
    return { ok: false, response: jsonResponse({ success: false, message: "Not logged in." }, 401) };
  }
  if (expectedUsername && username !== expectedUsername) {
    return { ok: false, response: jsonResponse({ success: false, message: "Forbidden." }, 403) };
  }

  return { ok: true, username: username };
}
