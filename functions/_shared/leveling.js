// Mirrors the client's copy in app.js — cumulative sightings needed to REACH
// levels 2-5 (the initial catch is level 1 and doesn't count). Rarer animals
// level up faster. Variant-rarity animals are excluded — they never level up.
export const LEVEL_THRESHOLDS = {
  common: [10, 25, 100, 300],
  uncommon: [5, 20, 50, 100],
  rare: [3, 10, 25, 75],
  epic: [2, 5, 10, 25],
  legendary: [1, 3, 5, 10],
};
export const MAX_LEVEL = 5;

export function levelForSightings(sightings, rarity) {
  if (rarity === "variant") {
    return null;
  }
  const thresholds = LEVEL_THRESHOLDS[rarity] || LEVEL_THRESHOLDS.common;
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (sightings >= thresholds[i]) {
      level = i + 2;
    }
  }
  return Math.min(level, MAX_LEVEL);
}

// The highest a single stat can reach for that rarity, from leveling alone.
export const STAT_CAP_BY_RARITY = {
  common: 50,
  uncommon: 60,
  rare: 75,
  epic: 90,
  legendary: 100,
  variant: 100,
};

// Total stat points awarded (across attack/defense/healing) on each
// level-up, by rarity. Variant animals never level up, so they're excluded.
const LEVEL_UP_BOOST_RANGE = {
  common: [5, 10],
  uncommon: [7, 12],
  rare: [10, 15],
  epic: [20, 25],
  legendary: [30, 35],
};

function randomLevelUpBoostTotal(rarity) {
  const range = LEVEL_UP_BOOST_RANGE[rarity];
  if (!range) {
    return 0;
  }
  const [min, max] = range;
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Splits `total` into `n` random non-negative integers that sum to total
// (a "stars and bars" cut: pick n-1 random cut points along [0, total]).
function splitRandomly(total, n) {
  if (total <= 0) {
    return Array(n).fill(0);
  }
  const points = [0, total];
  for (let i = 0; i < n - 1; i++) {
    points.push(Math.floor(Math.random() * (total + 1)));
  }
  points.sort(function (a, b) {
    return a - b;
  });
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) {
    parts.push(points[i + 1] - points[i]);
  }
  return parts;
}

// Returns a new stats object with one level-up's worth of points added,
// randomly split across attack/defense/healing, clamped to the rarity's cap.
function applyLevelUpBoost(stats, rarity) {
  const cap = STAT_CAP_BY_RARITY[rarity] || 100;
  const statKeys = ["attack", "defense", "healing"];
  const parts = splitRandomly(randomLevelUpBoostTotal(rarity), statKeys.length);
  const next = Object.assign({}, stats);
  statKeys.forEach(function (key, i) {
    next[key] = Math.min(cap, (next[key] || 0) + parts[i]);
  });
  return next;
}

// Applies one level-up boost per level gained between fromLevel (exclusive)
// and toLevel (inclusive) — used both for a live level-up and for lazily
// backfilling a species that leveled up before it had an animal_stats row.
export function growStats(startStats, rarity, fromLevel, toLevel) {
  let stats = startStats;
  for (let lvl = fromLevel + 1; lvl <= toLevel; lvl++) {
    stats = applyLevelUpBoost(stats, rarity);
  }
  return stats;
}
