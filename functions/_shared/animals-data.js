// Server-side mirror of the CSV parsing in app.js's ensureAnimalsLoaded —
// fetched from the same deployed animals.csv via the Pages static-asset
// binding, so there's exactly one source of truth for species/rarity/base
// stats instead of a second copy that can drift out of sync.
let cachedAnimals = null;

export async function loadAnimalsData(env) {
  if (cachedAnimals) {
    return cachedAnimals;
  }

  const response = await env.ASSETS.fetch(new URL("/animals.csv", "http://internal"));
  const text = await response.text();

  const lines = text.trim().split("\n");
  const dataLines = lines.slice(1);

  const animals = {};
  dataLines
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    })
    .forEach(function (line) {
      const parts = line.split(",");
      animals[parts[0]] = {
        species: parts[0],
        rarity: parts[1],
        class: parts[2],
        attack: Number(parts[3]),
        defense: Number(parts[4]),
        healing: Number(parts[5]),
        starter: parts[6] === "yes",
      };
    });

  cachedAnimals = animals;
  return animals;
}
