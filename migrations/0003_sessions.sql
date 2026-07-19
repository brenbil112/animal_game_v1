-- Session tokens issued at login. Every request after login carries one of
-- these as a bearer token, so the server can verify who's actually calling
-- instead of just trusting whatever username appears in the URL.
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
