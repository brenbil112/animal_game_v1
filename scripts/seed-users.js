// Reusable seeding tool: generates a SQL file that creates accounts with
// salted/hashed PINs and seeds their starting unlocked roster. PINs are
// passed as arguments (not hardcoded) so this script can be committed
// without baking real credentials into version control.
//
// Usage: node scripts/seed-users.js admin:9999 user1:1111 user2:2222
//
// The hash scheme here (SHA-256 of salt + pin, hex-encoded) must match
// exactly what the login Pages Function uses to verify PINs later.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/seed-users.js username:pin [username:pin ...]");
  process.exit(1);
}

const USERS = args.map(function (arg) {
  const parts = arg.split(":");
  return { username: parts[0], pin: parts[1] };
});

const STARTER_SPECIES = ["mosquito", "ant", "crow", "spider", "pigeon", "house fly"];

function hashPin(pin, salt) {
  return crypto.createHash("sha256").update(salt + pin).digest("hex");
}

function sqlString(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}

const lines = [];
const now = Date.now();

USERS.forEach(function (user) {
  const salt = crypto.randomBytes(16).toString("hex");
  const pinHash = hashPin(user.pin, salt);

  lines.push(
    "INSERT INTO users (username, pin_hash, salt) VALUES (" +
      sqlString(user.username) + ", " + sqlString(pinHash) + ", " + sqlString(salt) + ");"
  );

  STARTER_SPECIES.forEach(function (species) {
    lines.push(
      "INSERT INTO unlocked_animals (username, species, unlocked_at) VALUES (" +
        sqlString(user.username) + ", " + sqlString(species) + ", " + now + ");"
    );
  });
});

const outputPath = path.join(__dirname, "..", "migrations", "seed-output.sql");
fs.writeFileSync(outputPath, lines.join("\n") + "\n");
console.log("Wrote " + outputPath);
