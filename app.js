const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username-input");
const pinInput = document.getElementById("pin-input");
const loginError = document.getElementById("login-error");

// ── API client ───────────────────────────────────────────────────────────

function getAuthToken() {
  return localStorage.getItem("authToken");
}

async function apiFetch(path, options) {
  options = options || {};
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const response = await fetch("/api" + path, {
    method: options.method || "GET",
    headers: headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  return response.json();
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(function (screen) {
    screen.classList.toggle("hidden", screen.id !== screenId);
  });
}

function showPanel(panelId) {
  document.querySelectorAll(".content-panel").forEach(function (panel) {
    panel.classList.toggle("hidden", panel.id !== panelId);
  });
}

function setActiveSectionNav(activeButton) {
  document.querySelectorAll(".section-nav-button").forEach(function (button) {
    button.classList.toggle("active", button === activeButton);
  });
}

function showHomeScreen(username) {
  document.querySelectorAll(".welcome-message").forEach(function (el) {
    el.textContent = "Logged in as: " + username;
  });

  document.getElementById("home-admin-button").classList.toggle("hidden", username !== "admin");

  showScreen("home-screen");
}

function showLoginScreen() {
  showScreen("login-screen");
  usernameInput.value = "";
  pinInput.value = "";
  loginError.classList.add("hidden");
}

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const enteredUsername = usernameInput.value.trim().toLowerCase();
  const enteredPin = pinInput.value.trim();

  const result = await apiFetch("/login", {
    method: "POST",
    body: { username: enteredUsername, pin: enteredPin },
  });

  if (result.success) {
    localStorage.setItem("loggedInUser", result.username);
    localStorage.setItem("authToken", result.token);
    showHomeScreen(result.username);
  } else {
    loginError.classList.remove("hidden");
  }
});

document.querySelectorAll(".logout-button").forEach(function (button) {
  button.addEventListener("click", function () {
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("authToken");
    showLoginScreen();
  });
});

document.getElementById("home-wars-button").addEventListener("click", async function () {
  showScreen("section-screen");
  showPanel("wars-panel");
  setActiveSectionNav(document.getElementById("nav-wars-button"));
  await renderMapTrigger("wars-map-trigger");
  await renderSwarmSlots();
});

document.getElementById("nav-wars-button").addEventListener("click", async function () {
  showPanel("wars-panel");
  setActiveSectionNav(document.getElementById("nav-wars-button"));
  await renderMapTrigger("wars-map-trigger");
  await renderSwarmSlots();
});

document.getElementById("home-animals-button").addEventListener("click", function () {
  showScreen("section-screen");
  showPanel("animals-home-panel");
  setActiveSectionNav(document.getElementById("nav-animals-button"));
});

document.getElementById("nav-animals-button").addEventListener("click", function () {
  showPanel("animals-home-panel");
  setActiveSectionNav(document.getElementById("nav-animals-button"));
});

document.getElementById("app-title").addEventListener("click", function () {
  const savedUser = localStorage.getItem("loggedInUser");
  if (savedUser) {
    showHomeScreen(savedUser);
  }
});

document.getElementById("home-admin-button").addEventListener("click", async function () {
  showScreen("admin-screen");
  await renderWarStatus();
  await renderMapTrigger("admin-map-trigger");
});

document.getElementById("admin-back-button").addEventListener("click", function () {
  showScreen("home-screen");
});

const WAR_GRID_SIZE = 13;
const BATTLE_GRID_SIZE = 20;
const BATTLE_CELL_SIZE = 44;
const TURN_DURATION_MS = 24 * 60 * 60 * 1000;

// Shared by the main war map and every territory battle: both are just
// "two players, strictly alternating, 24-hour-max turns" underneath.
function startTurn(player) {
  return { currentPlayer: player, turnStartedAt: Date.now(), hasActedThisTurn: false };
}

function isTurnExpired(turn) {
  return Date.now() - turn.turnStartedAt > TURN_DURATION_MS;
}

function otherPlayer(player, player1, player2) {
  return player === player1 ? player2 : player1;
}

function formatTurnStatus(turn) {
  const expiresAt = new Date(turn.turnStartedAt + TURN_DURATION_MS);
  return "Turn: " + turn.currentPlayer + " (expires " + expiresAt.toLocaleString() + ")";
}

// Builds a fresh war: 3 swarms per player lined up on opposite edges of the
// grid, animals snapshotted from whatever each player currently has saved in
// their swarm slots, and a random first turn.
async function generateWar(player1, player2) {
  const swarms = [];
  const player1Swarms = await fetchSwarms(player1);
  const player2Swarms = await fetchSwarms(player2);

  ["1", "2", "3"].forEach(function (swarmNumber, index) {
    swarms.push({
      id: player1 + "-" + swarmNumber,
      owner: player1,
      swarmNumber: swarmNumber,
      row: 0,
      col: index + 1,
      animals: player1Swarms[swarmNumber] || [],
      battleId: null,
    });
  });

  ["1", "2", "3"].forEach(function (swarmNumber, index) {
    swarms.push({
      id: player2 + "-" + swarmNumber,
      owner: player2,
      swarmNumber: swarmNumber,
      row: WAR_GRID_SIZE - 1,
      col: index + 1,
      animals: player2Swarms[swarmNumber] || [],
      battleId: null,
    });
  });

  const firstPlayer = Math.random() < 0.5 ? player1 : player2;

  return {
    player1: player1,
    player2: player2,
    size: WAR_GRID_SIZE,
    swarms: swarms,
    turn: startTurn(firstPlayer),
    battles: [],
  };
}

// The war state lives server-side now (one row in D1's active_war table),
// shared by both players' devices. Rather than thread `await` through the
// ~40 functions that read/write it (most of them deep inside render/click
// handlers), we keep a single in-memory cache: the few true "entry points"
// (opening the map, opening a battle, entering the Wars tab) refresh it from
// the server, and everything in between keeps reading/writing the cache
// exactly like it used to read/write localStorage — same shape, same sync
// calls, just backed by a fire-and-forget PUT instead of a local write.
let cachedWar = null;

async function loadWarCache() {
  const war = await apiFetch("/war");
  cachedWar = (war && war.size === WAR_GRID_SIZE && Array.isArray(war.swarms)) ? war : null;
}

function getActiveWar() {
  return cachedWar;
}

function saveActiveWar(war) {
  cachedWar = war;
  apiFetch("/war", { method: "PUT", body: war }).catch(function (error) {
    console.error("Failed to save war state:", error);
  });
}

async function renderWarStatus() {
  await loadWarCache();

  const statusEl = document.getElementById("war-status");
  const war = getActiveWar();

  if (war) {
    statusEl.textContent = "Active war: " + war.player1 + " vs " + war.player2;
  } else {
    statusEl.textContent = "No active war yet.";
  }
}

// Renders the small clickable placeholder shown before the map is opened.
async function renderMapTrigger(containerId) {
  await loadWarCache();

  const container = document.getElementById(containerId);
  const war = getActiveWar();

  container.innerHTML = "";

  if (!war) {
    container.className = "map-trigger no-war";
    container.textContent = "No active war yet.";
    return;
  }

  container.className = "map-trigger";
  container.textContent = "🗺️ " + war.player1 + " vs " + war.player2 + " — click to view the map";
  container.addEventListener("click", openWarMapFullscreen);
}

document.getElementById("start-war-button").addEventListener("click", async function () {
  const war = await generateWar("user1", "user2");
  saveActiveWar(war);
  await renderWarStatus();
  await renderMapTrigger("admin-map-trigger");
});

// Touchscreens already get panning for free from native scrolling on an
// overflow:auto container, but a mouse has no built-in way to drag one —
// this adds click-and-drag panning for desktop, and swallows the click that
// would otherwise land on whatever cell the drag happened to end on (so
// panning the map doesn't also select/move/attack).
function enableMapPanning(container) {
  let isDragging = false;
  let hasDragged = false;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;

  container.addEventListener("mousedown", function (event) {
    if (event.button !== 0) {
      return;
    }
    isDragging = true;
    hasDragged = false;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = container.scrollLeft;
    startScrollTop = container.scrollTop;
    container.classList.add("panning");
  });

  document.addEventListener("mousemove", function (event) {
    if (!isDragging) {
      return;
    }
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      hasDragged = true;
    }
    container.scrollLeft = startScrollLeft - deltaX;
    container.scrollTop = startScrollTop - deltaY;
  });

  document.addEventListener("mouseup", function () {
    isDragging = false;
    container.classList.remove("panning");
  });

  container.addEventListener("click", function (event) {
    if (hasDragged) {
      event.stopPropagation();
      hasDragged = false;
    }
  }, true);
}

enableMapPanning(document.getElementById("war-map-grid"));
enableMapPanning(document.getElementById("battle-map-grid"));

// Boards are bigger than any screen now, so opening one straight to its
// top-left corner would hide most of the action — center the scroll
// position instead, as a reasonable default before the player pans around.
function centerScroll(container) {
  container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
  container.scrollTop = (container.scrollHeight - container.clientHeight) / 2;
}

// ── Main war map ─────────────────────────────────────────────────────────

let selectedSwarmId = null;

function findSwarmAt(war, row, col) {
  return war.swarms.find(function (swarm) {
    return swarm.row === row && swarm.col === col && !swarm.battleId;
  });
}

function findBattleAt(war, row, col) {
  return war.battles.find(function (battle) {
    return battle.row === row && battle.col === col && !battle.resolved;
  });
}

function renderWarMapGrid() {
  const war = getActiveWar();
  if (!war) {
    return;
  }

  if (isTurnExpired(war.turn)) {
    war.turn = startTurn(otherPlayer(war.turn.currentPlayer, war.player1, war.player2));
    saveActiveWar(war);
  }

  const grid = document.getElementById("war-map-grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = "repeat(" + war.size + ", 50px)";
  grid.style.gridTemplateRows = "repeat(" + war.size + ", 50px)";

  const baseCol = Math.floor(war.size / 2);

  for (let row = 0; row < war.size; row++) {
    for (let col = 0; col < war.size; col++) {
      const cell = document.createElement("div");
      cell.className = "map-cell";

      if (row === 0 && col === baseCol) {
        cell.classList.add("base-user1");
      } else if (row === war.size - 1 && col === baseCol) {
        cell.classList.add("base-user2");
      }

      const battle = findBattleAt(war, row, col);
      const swarm = findSwarmAt(war, row, col);

      if (battle) {
        cell.classList.add("battle-cell");
        cell.textContent = "⚔️";
        cell.addEventListener("click", function () {
          openBattleFullscreen(battle.id);
        });
      } else {
        if (swarm) {
          const token = document.createElement("div");
          token.className = "swarm-token owner-" + swarm.owner;
          token.textContent = swarm.swarmNumber;
          if (swarm.id === selectedSwarmId) {
            token.classList.add("selected");
          }
          cell.appendChild(token);
        }

        cell.addEventListener("click", function () {
          handleWarCellClick(war, row, col, swarm);
        });
      }

      grid.appendChild(cell);
    }
  }

  document.getElementById("war-turn-status").textContent = formatTurnStatus(war.turn);

  const currentUser = localStorage.getItem("loggedInUser");
  document.getElementById("war-end-turn-button").disabled = currentUser !== war.turn.currentPlayer;
}

function handleWarCellClick(war, row, col, swarmAtCell) {
  const currentUser = localStorage.getItem("loggedInUser");

  if (war.turn.currentPlayer !== currentUser || war.turn.hasActedThisTurn) {
    return;
  }

  if (!selectedSwarmId) {
    if (swarmAtCell && swarmAtCell.owner === currentUser) {
      selectedSwarmId = swarmAtCell.id;
      renderWarMapGrid();
    }
    return;
  }

  if (swarmAtCell && swarmAtCell.id === selectedSwarmId) {
    selectedSwarmId = null;
    renderWarMapGrid();
    return;
  }

  if (swarmAtCell && swarmAtCell.owner === currentUser) {
    selectedSwarmId = swarmAtCell.id;
    renderWarMapGrid();
    return;
  }

  const selectedSwarm = war.swarms.find(function (swarm) {
    return swarm.id === selectedSwarmId;
  });
  const isAdjacent = Math.abs(row - selectedSwarm.row) + Math.abs(col - selectedSwarm.col) === 1;

  if (!isAdjacent) {
    return;
  }

  if (swarmAtCell && swarmAtCell.owner !== currentUser) {
    const confirmed = window.confirm(
      "Start a territory battle against " + swarmAtCell.owner + "'s Swarm " + swarmAtCell.swarmNumber + "?"
    );
    if (!confirmed) {
      return;
    }
    startTerritoryBattle(war, selectedSwarm, swarmAtCell, row, col);
  } else {
    selectedSwarm.row = row;
    selectedSwarm.col = col;
  }

  war.turn.hasActedThisTurn = true;
  selectedSwarmId = null;
  saveActiveWar(war);
  renderWarMapGrid();
}

function tilesTouch(row1, col1, row2, col2) {
  return Math.abs(row1 - row2) <= 1 && Math.abs(col1 - col2) <= 1 && !(row1 === row2 && col1 === col2);
}

// Builds the terrain grid for a battle: 4 outposts that don't touch each
// other (not even diagonally), one connected 5-tile pond of water, 12
// scattered forest tiles, everything else left empty.
function generateBattleTerrain(size) {
  const terrain = [];
  for (let row = 0; row < size; row++) {
    terrain.push(new Array(size).fill("empty"));
  }

  const outpostPositions = [];
  while (outpostPositions.length < 4) {
    const row = Math.floor(Math.random() * size);
    const col = Math.floor(Math.random() * size);

    if (terrain[row][col] !== "empty") {
      continue;
    }

    const tooClose = outpostPositions.some(function (pos) {
      return tilesTouch(row, col, pos.row, pos.col);
    });

    if (!tooClose) {
      terrain[row][col] = "outpost";
      outpostPositions.push({ row: row, col: col });
    }
  }

  let seedRow = Math.floor(Math.random() * size);
  let seedCol = Math.floor(Math.random() * size);
  while (terrain[seedRow][seedCol] !== "empty") {
    seedRow = Math.floor(Math.random() * size);
    seedCol = Math.floor(Math.random() * size);
  }
  terrain[seedRow][seedCol] = "water";
  const waterTiles = [{ row: seedRow, col: seedCol }];

  while (waterTiles.length < 5) {
    const fromTile = waterTiles[Math.floor(Math.random() * waterTiles.length)];
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const direction = directions[Math.floor(Math.random() * directions.length)];
    const newRow = fromTile.row + direction[0];
    const newCol = fromTile.col + direction[1];

    if (newRow < 0 || newRow >= size || newCol < 0 || newCol >= size) {
      continue;
    }
    if (terrain[newRow][newCol] !== "empty") {
      continue;
    }

    terrain[newRow][newCol] = "water";
    waterTiles.push({ row: newRow, col: newCol });
  }

  let forestPlaced = 0;
  while (forestPlaced < 12) {
    const row = Math.floor(Math.random() * size);
    const col = Math.floor(Math.random() * size);

    if (terrain[row][col] === "empty") {
      terrain[row][col] = "forest";
      forestPlaced++;
    }
  }

  return terrain;
}

function startTerritoryBattle(war, attackerSwarm, defenderSwarm, row, col) {
  const battleId = "battle-" + Date.now();

  attackerSwarm.row = row;
  attackerSwarm.col = col;
  attackerSwarm.battleId = battleId;
  defenderSwarm.battleId = battleId;

  const battlePlayer1 = attackerSwarm.owner;
  const battlePlayer2 = defenderSwarm.owner;
  const midRow = Math.floor(BATTLE_GRID_SIZE / 2) - 1;
  const animals = [];

  attackerSwarm.animals.forEach(function (species, index) {
    animals.push({
      id: battleId + "-" + battlePlayer1 + "-" + index,
      owner: battlePlayer1,
      species: species,
      row: midRow + index,
      col: 0,
      incapacitated: false,
      hasActedThisTurn: false,
      ambushing: false,
      ambushTriggeredThisEnemyTurn: false,
      movementLockTurnsRemaining: 0,
      trackedTurnsRemaining: 0,
    });
  });

  defenderSwarm.animals.forEach(function (species, index) {
    animals.push({
      id: battleId + "-" + battlePlayer2 + "-" + index,
      owner: battlePlayer2,
      species: species,
      row: midRow + index,
      col: BATTLE_GRID_SIZE - 1,
      incapacitated: false,
      hasActedThisTurn: false,
      ambushing: false,
      ambushTriggeredThisEnemyTurn: false,
      movementLockTurnsRemaining: 0,
      trackedTurnsRemaining: 0,
    });
  });

  const firstPlayer = Math.random() < 0.5 ? battlePlayer1 : battlePlayer2;

  war.battles.push({
    id: battleId,
    row: row,
    col: col,
    player1: battlePlayer1,
    player2: battlePlayer2,
    size: BATTLE_GRID_SIZE,
    terrain: generateBattleTerrain(BATTLE_GRID_SIZE),
    animals: animals,
    turn: startTurn(firstPlayer),
    resolved: false,
  });
}

async function openWarMapFullscreen() {
  await loadWarCache();
  const war = getActiveWar();
  if (!war) {
    return;
  }

  document.getElementById("war-map-overlay-heading").textContent = war.player1 + " vs " + war.player2;
  selectedSwarmId = null;
  renderWarMapGrid();

  document.getElementById("war-map-overlay").classList.remove("hidden");
  centerScroll(document.getElementById("war-map-grid"));
}

function closeWarMapFullscreen() {
  document.getElementById("war-map-overlay").classList.add("hidden");
}

document.getElementById("war-map-minimize-button").addEventListener("click", closeWarMapFullscreen);

document.getElementById("war-end-turn-button").addEventListener("click", function () {
  const war = getActiveWar();
  if (!war) {
    return;
  }

  const currentUser = localStorage.getItem("loggedInUser");
  if (currentUser !== war.turn.currentPlayer) {
    return;
  }

  war.turn = startTurn(otherPlayer(war.turn.currentPlayer, war.player1, war.player2));
  selectedSwarmId = null;
  saveActiveWar(war);
  renderWarMapGrid();
});

// ── Territory battles ────────────────────────────────────────────────────
//
// Each turn, every one of the active player's not-yet-acted units can both
// move (0-4 squares) and take one action (Advance-Wars style — act with your
// whole army before ending your turn), rather than just one unit per turn.

const BATTLE_MOVE_RANGE = 4;

let selectedAnimalId = null;
let currentBattleId = null;
let battlePhase = null; // null | "moving" | "acting" | "targeting-attack"
let reachableTiles = null; // Set of "row,col" strings, computed when a unit is selected
let hiddenAmbushBlockers = null; // Map of "row,col" -> { ambusher, stopAt }, tiles hidden by enemy ambush

function getBattleById(war, battleId) {
  return war.battles.find(function (battle) {
    return battle.id === battleId;
  });
}

// A swarm slot stays editable right up until its war-map token gets pulled
// into a battle — after that it's locked (returns the battle) until that
// battle resolves, so players can't reshuffle animals out of a fight in
// progress from the Wars tab.
function findLockingBattle(war, username, swarmNumber) {
  if (!war) {
    return null;
  }
  const warSwarm = war.swarms.find(function (swarm) {
    return swarm.owner === username && swarm.swarmNumber === swarmNumber && swarm.battleId;
  });
  if (!warSwarm) {
    return null;
  }
  const battle = getBattleById(war, warSwarm.battleId);
  return battle && !battle.resolved ? battle : null;
}

function battleWinner(battle) {
  const player1Alive = battle.animals.some(function (animal) {
    return animal.owner === battle.player1 && !animal.incapacitated;
  });
  return player1Alive ? battle.player1 : battle.player2;
}

function checkBattleResolved(battle) {
  const player1Alive = battle.animals.some(function (a) {
    return a.owner === battle.player1 && !a.incapacitated;
  });
  const player2Alive = battle.animals.some(function (a) {
    return a.owner === battle.player2 && !a.incapacitated;
  });
  if (!player1Alive || !player2Alive) {
    battle.resolved = true;
  }
}

function resetActedFlagsForPlayer(battle, player) {
  battle.animals.forEach(function (animal) {
    if (animal.owner === player) {
      animal.hasActedThisTurn = false;
    }
  });
}

// An ambush can only trigger once per "enemy turn" — this resets that
// allowance for a player's ambushing units right as their opponent's turn
// begins, since that's the turn during which their ambush might fire.
function resetAmbushTriggersForPlayer(battle, player) {
  battle.animals.forEach(function (animal) {
    if (animal.owner === player) {
      animal.ambushTriggeredThisEnemyTurn = false;
    }
  });
}

// A locked/tracked unit's countdown should tick down once per turn its OWNER
// actually experiences — so this decrements for whichever player's turn is
// ENDING (they just "used up" one of their counted turns), not the player
// starting next.
function decrementTurnCounters(battle, player) {
  battle.animals.forEach(function (animal) {
    if (animal.owner !== player) {
      return;
    }
    if (animal.movementLockTurnsRemaining > 0) {
      animal.movementLockTurnsRemaining -= 1;
    }
    if (animal.trackedTurnsRemaining > 0) {
      animal.trackedTurnsRemaining -= 1;
    }
  });
}

function advanceBattleTurn(battle) {
  const endingPlayer = battle.turn.currentPlayer;
  const nextPlayer = otherPlayer(endingPlayer, battle.player1, battle.player2);

  decrementTurnCounters(battle, endingPlayer);
  battle.turn = startTurn(nextPlayer);
  resetActedFlagsForPlayer(battle, nextPlayer);
  resetAmbushTriggersForPlayer(battle, otherPlayer(nextPlayer, battle.player1, battle.player2));
}

// BFS out from a unit's tile up to BATTLE_MOVE_RANGE steps, in the 4 cardinal
// directions only. Any tile occupied by a visible unit (friendly, or a
// visible enemy) is a wall — can't pass through or land on it. A tile hidden
// by an enemy ambush looks just like empty terrain (it's not excluded from
// pathing here), but it's never added to `reachable` either, since the unit
// physically can't stand there — instead it's recorded in `hiddenBlockers`,
// keyed by that tile, pointing at the ambusher and the last safe tile before
// it, so the click handler can detect "walked into a hidden unit" and stop
// the move short instead of just silently rejecting the click.
function computeReachableTiles(battle, unit) {
  const reachable = new Set();
  const hiddenBlockers = new Map();
  const startKey = unit.row + "," + unit.col;
  reachable.add(startKey);

  // Ambushing units give up movement entirely until they End Ambush, and a
  // unit just forced out of ambush by an enemy Scout stays movement-locked
  // for its one following turn even though it's no longer ambushing.
  if (unit.ambushing || unit.movementLockTurnsRemaining > 0) {
    return { reachable: reachable, hiddenBlockers: hiddenBlockers };
  }

  let frontier = [{ row: unit.row, col: unit.col }];

  for (let step = 0; step < BATTLE_MOVE_RANGE; step++) {
    const nextFrontier = [];

    frontier.forEach(function (tile) {
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (delta) {
        const newRow = tile.row + delta[0];
        const newCol = tile.col + delta[1];
        const key = newRow + "," + newCol;

        if (newRow < 0 || newRow >= battle.size || newCol < 0 || newCol >= battle.size) {
          return;
        }
        if (reachable.has(key) || hiddenBlockers.has(key)) {
          return;
        }

        const occupant = battle.animals.find(function (a) {
          return !a.incapacitated && a.row === newRow && a.col === newCol;
        });

        if (occupant) {
          const isHiddenEnemy = occupant.ambushing && occupant.owner !== unit.owner;
          if (isHiddenEnemy) {
            hiddenBlockers.set(key, { ambusher: occupant, stopAt: tile });
          }
          return;
        }

        reachable.add(key);
        nextFrontier.push({ row: newRow, col: newCol });
      });
    });

    frontier = nextFrontier;
  }

  return { reachable: reachable, hiddenBlockers: hiddenBlockers };
}

// Generic "heading + message + OK" popup — used for combat results, ambush/
// scout notifications, and daily sightings confirmations alike.
function showInfoPopup(heading, message) {
  document.getElementById("info-popup-heading").textContent = heading;
  document.getElementById("info-popup-message").textContent = message;
  document.getElementById("info-popup-overlay").classList.remove("hidden");
}

function closeInfoPopup() {
  document.getElementById("info-popup-overlay").classList.add("hidden");
}

document.getElementById("info-popup-close-button").addEventListener("click", closeInfoPopup);
document.getElementById("info-popup-backdrop").addEventListener("click", closeInfoPopup);

// One Tutorial/Rules button per screen (same pattern as .logout-button and
// .welcome-message) all open the same static rules content.
function closeRulesModal() {
  document.getElementById("rules-modal-overlay").classList.add("hidden");
}

document.querySelectorAll(".tutorial-button").forEach(function (button) {
  button.addEventListener("click", function () {
    document.getElementById("rules-modal-overlay").classList.remove("hidden");
  });
});
document.getElementById("rules-modal-close-button").addEventListener("click", closeRulesModal);
document.getElementById("rules-modal-backdrop").addEventListener("click", closeRulesModal);

// Shared by normal attacks and ambush triggers: a weighted coin flip that
// incapacitates the loser and sends them to their owner's hospital. Doesn't
// show the popup itself — callers phrase the message differently (a normal
// attack names both animals; an ambush hides the ambusher's identity).
function resolveCombat(battle, attacker, defender, attackerWinChance) {
  const attackerWins = Math.random() < attackerWinChance;
  const winner = attackerWins ? attacker : defender;
  const loser = attackerWins ? defender : attacker;

  loser.incapacitated = true;
  admitToHospital(loser.owner, loser.species);
  checkBattleResolved(battle);

  return { winner: winner, loser: loser };
}

const RANGED_ATTACK_HIT_CHANCE = 0.25;
const SCOUT_RANGE = 5;
const TRACKED_DURATION_TURNS = 3;

// Exactly 3 tiles away along a single cardinal direction (straight up, down,
// left, or right) — not a diagonal-ish combination that happens to sum to 3,
// and not any other distance. Deliberately narrow; this used to allow any
// Manhattan distance of 2-3, which made it too strong.
function isInRangedAttackRange(rowA, colA, rowB, colB) {
  const sameRowExactly3 = rowA === rowB && Math.abs(colA - colB) === 3;
  const sameColExactly3 = colA === colB && Math.abs(rowA - rowB) === 3;
  return sameRowExactly3 || sameColExactly3;
}

// No risk to the attacker either way — a hit sends the target to the
// hospital, a miss just does nothing. Returns whether it hit.
function resolveRangedAttack(battle, target) {
  const hit = Math.random() < RANGED_ATTACK_HIT_CHANCE;
  if (hit) {
    target.incapacitated = true;
    admitToHospital(target.owner, target.species);
    checkBattleResolved(battle);
  }
  return hit;
}

// Marks every non-incapacitated enemy within SCOUT_RANGE as tracked for 3 of
// their owner's turns. Anyone caught ambushing is also forced out of hiding
// (revealed) and movement-locked for their next turn, same as if they'd
// chosen End Ambush themselves.
function performScoutAction(battle, scouter) {
  const enemyOwner = otherPlayer(scouter.owner, battle.player1, battle.player2);
  const tracked = [];
  const revealed = [];

  battle.animals.forEach(function (a) {
    if (a.owner !== enemyOwner || a.incapacitated) {
      return;
    }
    if (Math.abs(a.row - scouter.row) + Math.abs(a.col - scouter.col) > SCOUT_RANGE) {
      return;
    }

    if (a.ambushing) {
      a.ambushing = false;
      a.movementLockTurnsRemaining = 1;
      revealed.push(a.species);
    }

    a.trackedTurnsRemaining = TRACKED_DURATION_TURNS;
    tracked.push(a.species);
  });

  let message;
  if (tracked.length === 0) {
    message = "No enemy units detected within range.";
  } else {
    message = "Tracked: " + tracked.map(capitalize).join(", ") + ".";
    if (revealed.length > 0) {
      message += " Revealed from ambush: " + revealed.map(capitalize).join(", ") + ".";
    }
  }
  showInfoPopup("Scout Report", message);
}

// Checks every enemy ambushing unit against a mover that just repositioned —
// any of them within 3 tiles that hasn't already ambushed this enemy turn
// automatically attacks, at a 60/40 advantage in the ambusher's favor. The
// ambusher's identity is never revealed to the mover; only the outcome is.
function checkAmbushTriggers(battle, mover) {
  const enemyOwner = otherPlayer(mover.owner, battle.player1, battle.player2);

  const ambushers = battle.animals.filter(function (a) {
    return a.owner === enemyOwner && a.ambushing && !a.incapacitated && !a.ambushTriggeredThisEnemyTurn;
  });

  ambushers.forEach(function (ambusher) {
    if (mover.incapacitated) {
      return; // already taken out by an earlier ambush from this same move
    }

    const distance = Math.abs(mover.row - ambusher.row) + Math.abs(mover.col - ambusher.col);
    if (distance > 3) {
      return;
    }

    ambusher.ambushTriggeredThisEnemyTurn = true;
    const result = resolveCombat(battle, ambusher, mover, 0.6);

    const message = result.winner === mover
      ? "Your " + capitalize(mover.species) + " was ambushed by a hidden enemy — but won the fight!"
      : "Your " + capitalize(mover.species) + " was ambushed by a hidden enemy and defeated! It has been sent to the hospital.";
    showInfoPopup("Ambush!", message);
  });
}

function selectAnimalForTurn(battle, unit) {
  selectedAnimalId = unit.id;
  const computed = computeReachableTiles(battle, unit);
  reachableTiles = computed.reachable;
  hiddenAmbushBlockers = computed.hiddenBlockers;
  battlePhase = "moving";
}

function deselectBattleUnit() {
  selectedAnimalId = null;
  reachableTiles = null;
  hiddenAmbushBlockers = null;
  battlePhase = null;
}

function isInAttackRange(rowA, colA, rowB, colB) {
  const distance = Math.abs(rowA - rowB) + Math.abs(colA - colB);
  return distance >= 1 && distance <= 2;
}

function renderBattleGrid() {
  const war = getActiveWar();
  const battle = getBattleById(war, currentBattleId);
  if (!battle) {
    return;
  }

  if (!battle.resolved && isTurnExpired(battle.turn)) {
    advanceBattleTurn(battle);
    deselectBattleUnit();
    saveActiveWar(war);
  }

  const currentUser = localStorage.getItem("loggedInUser");

  const grid = document.getElementById("battle-map-grid");
  grid.innerHTML = "";

  // Cells stay a fixed, tap-friendly size regardless of board size — at
  // BATTLE_GRID_SIZE 20 that's bigger than any screen, so the container
  // scrolls/pans instead of shrinking cells down to illegibility.
  grid.style.gridTemplateColumns = "repeat(" + battle.size + ", " + BATTLE_CELL_SIZE + "px)";
  grid.style.gridTemplateRows = "repeat(" + battle.size + ", " + BATTLE_CELL_SIZE + "px)";

  const selectedAnimal = battle.animals.find(function (a) {
    return a.id === selectedAnimalId;
  });

  for (let row = 0; row < battle.size; row++) {
    for (let col = 0; col < battle.size; col++) {
      const cell = document.createElement("div");
      cell.className = "map-cell";

      const terrainType = battle.terrain ? battle.terrain[row][col] : "empty";
      if (terrainType !== "empty") {
        cell.classList.add("terrain-" + terrainType);
      }

      if (battlePhase === "moving" && reachableTiles.has(row + "," + col)) {
        cell.classList.add("reachable-tile");
      }

      if (battlePhase === "targeting-attack" && selectedAnimal && isInAttackRange(row, col, selectedAnimal.row, selectedAnimal.col)) {
        cell.classList.add("attackable-tile");
      }

      if (battlePhase === "targeting-ranged-attack" && selectedAnimal && isInRangedAttackRange(row, col, selectedAnimal.row, selectedAnimal.col)) {
        cell.classList.add("ranged-attackable-tile");
      }

      // Ambushing units are invisible to everyone except their own owner.
      const animal = battle.animals.find(function (a) {
        const isHiddenFromViewer = a.ambushing && a.owner !== currentUser;
        return a.row === row && a.col === col && !a.incapacitated && !isHiddenFromViewer;
      });

      if (animal) {
        const token = document.createElement("div");
        token.className = "animal-token owner-" + animal.owner;
        token.textContent = capitalize(animal.species).charAt(0);
        token.title = capitalize(animal.species) + " (" + animal.owner + ")" +
          (animal.hasActedThisTurn ? " — acted" : "") +
          (animal.ambushing ? " — ambushing" : "") +
          (animal.trackedTurnsRemaining > 0 ? " — tracked (" + animal.trackedTurnsRemaining + ")" : "");
        if (animal.id === selectedAnimalId) {
          token.classList.add("selected");
        }
        if (animal.hasActedThisTurn) {
          token.classList.add("acted");
        }
        if (animal.ambushing) {
          token.classList.add("ambushing");
        }
        if (animal.trackedTurnsRemaining > 0) {
          token.classList.add("tracked");
        }
        cell.appendChild(token);
      }

      cell.addEventListener("click", function () {
        handleBattleCellClick(war, battle, row, col, animal);
      });

      grid.appendChild(cell);
    }
  }

  const statusEl = document.getElementById("battle-turn-status");
  statusEl.textContent = battle.resolved
    ? "Battle over — " + battleWinner(battle) + " wins!"
    : formatTurnStatus(battle.turn);

  const isMyTurn = !battle.resolved && currentUser === battle.turn.currentPlayer;
  document.getElementById("battle-end-turn-button").disabled = !isMyTurn;

  const hintEl = document.getElementById("battle-phase-hint");
  const actionPanel = document.getElementById("battle-action-panel");
  actionPanel.classList.add("hidden");

  if (battle.resolved) {
    hintEl.textContent = "";
  } else if (!isMyTurn) {
    hintEl.textContent = "Waiting for " + battle.turn.currentPlayer + "...";
  } else if (battlePhase === "moving") {
    hintEl.textContent = selectedAnimal.ambushing
      ? "This unit is ambushing and can't move — click it again to proceed to actions."
      : "Choose a highlighted tile to move to, or click " + capitalize(selectedAnimal.species) + " again to stay put.";
  } else if (battlePhase === "acting" || battlePhase === "targeting-attack" || battlePhase === "targeting-ranged-attack") {
    actionPanel.classList.remove("hidden");

    // A hidden (ambushing) enemy can never be a valid target for either kind
    // of attack — you can't aim at what you can't see.
    const isVisibleEnemy = function (a) {
      return !a.incapacitated && !a.ambushing && a.owner !== currentUser;
    };

    const hasEnemyInAttackRange = battle.animals.some(function (a) {
      return isVisibleEnemy(a) && isInAttackRange(a.row, a.col, selectedAnimal.row, selectedAnimal.col);
    });
    document.querySelector('.battle-action-button[data-action="attack"]').disabled = !hasEnemyInAttackRange;

    const hasEnemyInRangedRange = battle.animals.some(function (a) {
      return isVisibleEnemy(a) && isInRangedAttackRange(a.row, a.col, selectedAnimal.row, selectedAnimal.col);
    });
    document.querySelector('.battle-action-button[data-action="ranged-attack"]').disabled = !hasEnemyInRangedRange;

    const currentTerrain = battle.terrain ? battle.terrain[selectedAnimal.row][selectedAnimal.col] : "empty";
    const isTracked = selectedAnimal.trackedTurnsRemaining > 0;
    const canSetAmbush = !selectedAnimal.ambushing && !isTracked && (currentTerrain === "forest" || currentTerrain === "water");
    document.querySelector('.battle-action-button[data-action="set-ambush"]').disabled = !canSetAmbush;
    document.querySelector('.battle-action-button[data-action="end-ambush"]').disabled = !selectedAnimal.ambushing;

    if (battlePhase === "targeting-attack") {
      hintEl.textContent = "Choose an enemy within 2 tiles to attack, or click Attack again to cancel.";
    } else if (battlePhase === "targeting-ranged-attack") {
      hintEl.textContent = "Choose a visible enemy exactly 3 tiles away in a straight line, or click Ranged Attack again to cancel.";
    } else if (isTracked) {
      hintEl.textContent = "Choose an action for " + capitalize(selectedAnimal.species) + " (tracked — can't set ambush).";
    } else {
      hintEl.textContent = "Choose an action for " + capitalize(selectedAnimal.species) + ".";
    }
  } else {
    hintEl.textContent = "Select one of your units to move and act.";
  }
}

function handleBattleCellClick(war, battle, row, col, animalAtCell) {
  if (battle.resolved) {
    return;
  }

  const currentUser = localStorage.getItem("loggedInUser");
  if (battle.turn.currentPlayer !== currentUser) {
    return;
  }

  if (battlePhase === "targeting-attack") {
    const attacker = battle.animals.find(function (a) {
      return a.id === selectedAnimalId;
    });
    const inRange = animalAtCell && isInAttackRange(row, col, attacker.row, attacker.col);

    if (animalAtCell && animalAtCell.owner !== currentUser && inRange) {
      const result = resolveCombat(battle, attacker, animalAtCell, 0.5);
      const message = result.winner === attacker
        ? "Your " + capitalize(attacker.species) + " defeated the enemy " + capitalize(result.loser.species) + "!"
        : "Your " + capitalize(attacker.species) + " was defeated by the enemy " + capitalize(result.winner.species) + " and sent to the hospital.";
      showInfoPopup("Combat Result", message);

      attacker.hasActedThisTurn = true;
      deselectBattleUnit();
      saveActiveWar(war);
      renderBattleGrid();
    }
    return;
  }

  if (battlePhase === "targeting-ranged-attack") {
    const attacker = battle.animals.find(function (a) {
      return a.id === selectedAnimalId;
    });
    const inRange = animalAtCell && isInRangedAttackRange(row, col, attacker.row, attacker.col);

    if (animalAtCell && animalAtCell.owner !== currentUser && inRange) {
      const hit = resolveRangedAttack(battle, animalAtCell);
      const message = hit
        ? "Your " + capitalize(attacker.species) + "'s ranged attack hit! The enemy " + capitalize(animalAtCell.species) + " has been sent to the hospital."
        : "Your " + capitalize(attacker.species) + "'s ranged attack missed.";
      showInfoPopup("Ranged Attack", message);

      attacker.hasActedThisTurn = true;
      deselectBattleUnit();
      saveActiveWar(war);
      renderBattleGrid();
    }
    return;
  }

  if (battlePhase === "moving") {
    const key = row + "," + col;

    if (reachableTiles.has(key)) {
      const unit = battle.animals.find(function (a) {
        return a.id === selectedAnimalId;
      });
      const actuallyMoved = unit.row !== row || unit.col !== col;
      unit.row = row;
      unit.col = col;

      if (actuallyMoved) {
        checkAmbushTriggers(battle, unit);
      }

      if (unit.incapacitated) {
        // Ambushed and defeated mid-move — no action phase for this unit.
        deselectBattleUnit();
      } else {
        battlePhase = "acting";
      }

      saveActiveWar(war);
      renderBattleGrid();
      return;
    }

    if (hiddenAmbushBlockers.has(key)) {
      const blocker = hiddenAmbushBlockers.get(key);
      const unit = battle.animals.find(function (a) {
        return a.id === selectedAnimalId;
      });

      // Looked like empty terrain — the unit gets stopped one tile short
      // of the hidden ambusher instead of completing the move.
      unit.row = blocker.stopAt.row;
      unit.col = blocker.stopAt.col;

      if (!blocker.ambusher.ambushTriggeredThisEnemyTurn) {
        blocker.ambusher.ambushTriggeredThisEnemyTurn = true;
        const result = resolveCombat(battle, blocker.ambusher, unit, 0.6);
        const message = result.winner === unit
          ? "Your " + capitalize(unit.species) + " walked into a hidden enemy — but won the fight!"
          : "Your " + capitalize(unit.species) + " walked into a hidden enemy and was defeated! It has been sent to the hospital.";
        showInfoPopup("Ambush!", message);
      } else {
        showInfoPopup("Blocked", "Your " + capitalize(unit.species) + " was mysteriously blocked and stopped short.");
      }

      if (unit.incapacitated) {
        deselectBattleUnit();
      } else {
        battlePhase = "acting";
      }

      saveActiveWar(war);
      renderBattleGrid();
      return;
    }

    if (animalAtCell && animalAtCell.owner === currentUser && !animalAtCell.hasActedThisTurn) {
      selectAnimalForTurn(battle, animalAtCell);
      renderBattleGrid();
    }
    return;
  }

  if (battlePhase === "acting") {
    return; // handled by the action panel's own buttons
  }

  if (animalAtCell && animalAtCell.owner === currentUser && !animalAtCell.hasActedThisTurn) {
    selectAnimalForTurn(battle, animalAtCell);
    renderBattleGrid();
  }
}

document.querySelectorAll(".battle-action-button[data-action]").forEach(function (button) {
  button.addEventListener("click", function () {
    if (button.disabled) {
      return;
    }

    const action = button.dataset.action;

    if (action === "attack") {
      // Clicking Attack again while already targeting cancels back to the
      // action panel, instead of getting stuck with no way out.
      battlePhase = battlePhase === "targeting-attack" ? "acting" : "targeting-attack";
      renderBattleGrid();
      return;
    }

    if (action === "ranged-attack") {
      battlePhase = battlePhase === "targeting-ranged-attack" ? "acting" : "targeting-ranged-attack";
      renderBattleGrid();
      return;
    }

    if (action === "set-ambush" || action === "end-ambush") {
      const war = getActiveWar();
      const battle = getBattleById(war, currentBattleId);
      const unit = battle.animals.find(function (a) {
        return a.id === selectedAnimalId;
      });

      unit.ambushing = action === "set-ambush";
      if (action === "set-ambush") {
        unit.ambushTriggeredThisEnemyTurn = false;
      }
      unit.hasActedThisTurn = true;

      deselectBattleUnit();
      saveActiveWar(war);
      renderBattleGrid();
      return;
    }

    if (action === "scout") {
      const war = getActiveWar();
      const battle = getBattleById(war, currentBattleId);
      const unit = battle.animals.find(function (a) {
        return a.id === selectedAnimalId;
      });

      performScoutAction(battle, unit);
      unit.hasActedThisTurn = true;

      deselectBattleUnit();
      saveActiveWar(war);
      renderBattleGrid();
    }
  });
});

document.getElementById("battle-no-action-button").addEventListener("click", function () {
  const war = getActiveWar();
  const battle = getBattleById(war, currentBattleId);
  const unit = battle.animals.find(function (a) {
    return a.id === selectedAnimalId;
  });

  if (unit) {
    unit.hasActedThisTurn = true;
  }

  deselectBattleUnit();
  saveActiveWar(war);
  renderBattleGrid();
});

async function openBattleFullscreen(battleId) {
  await loadWarCache();
  const war = getActiveWar();
  const battle = getBattleById(war, battleId);
  if (!battle) {
    return;
  }

  currentBattleId = battleId;
  deselectBattleUnit();

  document.getElementById("battle-overlay-heading").textContent =
    battle.player1 + " vs " + battle.player2 + " — Territory Battle";

  // Must unhide before rendering — while display:none, the grid has no
  // layout box, so centering the scroll position below would compute against
  // a 0-sized container instead of the real available space.
  document.getElementById("battle-overlay").classList.remove("hidden");
  renderBattleGrid();
  centerScroll(document.getElementById("battle-map-grid"));
}

function closeBattleFullscreen() {
  document.getElementById("battle-overlay").classList.add("hidden");
}

document.getElementById("battle-zoom-out-button").addEventListener("click", closeBattleFullscreen);

document.getElementById("battle-end-turn-button").addEventListener("click", function () {
  const war = getActiveWar();
  const battle = getBattleById(war, currentBattleId);
  if (!battle || battle.resolved) {
    return;
  }

  const currentUser = localStorage.getItem("loggedInUser");
  if (currentUser !== battle.turn.currentPlayer) {
    return;
  }

  advanceBattleTurn(battle);
  deselectBattleUnit();
  saveActiveWar(war);
  renderBattleGrid();
});

// Re-fit the cell size if the window is resized while a battle is open —
// mainly for PC users resizing the browser window.
window.addEventListener("resize", function () {
  if (!document.getElementById("battle-overlay").classList.contains("hidden")) {
    renderBattleGrid();
  }
});

// ── Per-user data caches ─────────────────────────────────────────────────
//
// Hospital, unlocked animals, and sighting data now live server-side. These
// caches are refreshed (async) at the handful of screens that show them —
// Unlocked/Locked Animals, the swarm picker, and Log Daily Sightings — and
// read synchronously everywhere else (chip rendering, the flip card), the
// same "load at the entry point, read the cache in between" pattern used
// for the war state above.
const HOSPITAL_DURATION_MS = 72 * 60 * 60 * 1000;

let cachedHospital = [];
let cachedUnlockedExtra = [];
let cachedSightingCounts = {};
let cachedDailyLog = { date: "", loggedSpecies: [] };
let cachedAnimalStats = {};

async function refreshCurrentUserCaches(username) {
  const results = await Promise.all([
    apiFetch("/hospital/" + username),
    apiFetch("/unlocked/" + username),
    apiFetch("/sightings/" + username),
    apiFetch("/animal-stats/" + username),
  ]);

  cachedHospital = results[0];
  cachedUnlockedExtra = results[1];
  cachedSightingCounts = results[2].counts;
  cachedDailyLog = results[2].today;
  cachedAnimalStats = results[3];
}

function isSpeciesInjured(species) {
  return cachedHospital.some(function (entry) {
    return entry.species === species;
  });
}

// "starter" (from the CSV) is the default unlocked set shared by everyone.
// Sightings-based unlocks are per-user on top of that, since two players
// shouldn't unlock animals for each other just by spotting them.
function isUnlockedForUser(animal) {
  return animal.starter || cachedUnlockedExtra.includes(animal.species);
}

// Admits a defeated animal to its owner's hospital; the server also strips
// it out of their saved swarm slots so it can't be re-picked while it's
// recovering. Fire-and-forget (not awaited) so the whole battle system above
// can keep calling this synchronously, same as when it wrote to localStorage
// directly — the network request just happens in the background.
function admitToHospital(owner, species) {
  apiFetch("/hospital/" + owner, { method: "POST", body: { species: species } }).catch(function (error) {
    console.error("Failed to admit to hospital:", error);
  });

  if (owner === localStorage.getItem("loggedInUser")) {
    cachedHospital.push({ species: species, admittedAt: Date.now() });
  }
}

async function renderHospital() {
  const username = localStorage.getItem("loggedInUser");
  const hospital = await apiFetch("/hospital/" + username);
  const container = document.getElementById("hospital-list");
  container.innerHTML = "";

  if (hospital.length === 0) {
    container.textContent = "No animals currently in the hospital.";
    return;
  }

  const grid = document.createElement("div");
  grid.className = "animal-grid";

  hospital.forEach(function (entry) {
    const hoursLeft = Math.ceil((entry.admittedAt + HOSPITAL_DURATION_MS - Date.now()) / (60 * 60 * 1000));

    const chip = document.createElement("div");
    chip.className = "animal-chip injured";
    chip.textContent = "🩹 " + capitalize(entry.species) + " (" + hoursLeft + "h left)";
    grid.appendChild(chip);
  });

  container.appendChild(grid);
}

document.getElementById("show-hospital-button").addEventListener("click", async function () {
  showPanel("hospital-panel");
  await renderHospital();
});

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function createAnimalChip(animal, isLocked) {
  const isInjured = !isLocked && isSpeciesInjured(animal.species);

  const chip = document.createElement("div");
  chip.className = "animal-chip rarity-" + animal.rarity + (isLocked ? " locked" : "") + (isInjured ? " injured" : "");
  chip.innerHTML =
    (isLocked ? "🔒 " : "") +
    (isInjured ? '<span class="injured-cross">✚</span> ' : "") +
    capitalize(animal.species);
  chip.addEventListener("click", function () {
    openAnimalCard(animal, isLocked);
  });
  return chip;
}

const animalImageCache = {};
let currentCardSpecies = null;

function toTitleCase(text) {
  return text.replace(/\w\S*/g, function (word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

// Species whose Wikipedia article title doesn't match a plain title-cased
// guess of the common name — either because the plain guess lands on a
// disambiguation/index page with no photo (e.g. "robin"), or because it
// lands on a real but wrong article (e.g. "turkey" -> the country, "aussie"
// -> Australians). Verified individually against the REST summary API.
const WIKIPEDIA_TITLE_OVERRIDES = {
  "house fly": "Housefly",
  "gray squirrel": "Eastern gray squirrel",
  "robin": "American robin",
  "cardinal": "Northern cardinal",
  "fruit fly": "Drosophila melanogaster",
  "turkey": "Wild turkey",
  "black racer": "Eastern racer",
  "white ibis": "American white ibis",
  "black bear": "American black bear",
  "water mocassin": "Cottonmouth",
  "river otter": "North American river otter",
  "panther": "Florida panther",
  "aussie": "Australian Shepherd",
};

// Wikipedia's REST summary endpoint is free, CORS-enabled, and needs no API
// key — a real Google Image search would require a paid Custom Search API
// key and a backend to hide it, so this is the practical stand-in for now.
async function fetchAnimalImageUrl(species) {
  if (species in animalImageCache) {
    return animalImageCache[species];
  }

  let imageUrl = null;
  try {
    const title = (WIKIPEDIA_TITLE_OVERRIDES[species] || toTitleCase(species)).replace(/ /g, "_");
    const response = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + title);
    if (response.ok) {
      const data = await response.json();
      imageUrl = data.thumbnail ? data.thumbnail.source : null;
    }
  } catch (error) {
    imageUrl = null;
  }

  animalImageCache[species] = imageUrl;
  return imageUrl;
}

async function loadCardImage(species) {
  const imageUrl = await fetchAnimalImageUrl(species);

  // The card may have moved on to a different animal (or closed) by the
  // time this resolves — don't stomp on whatever's showing now.
  if (currentCardSpecies !== species || !imageUrl) {
    return;
  }

  const pictureArea = document.getElementById("card-picture-area");
  if (pictureArea) {
    pictureArea.innerHTML = `<img class="card-photo" src="${imageUrl}" alt="${capitalize(species)}">`;
    pictureArea.classList.add("has-photo");
  }
}

function openAnimalCard(animal, isLocked) {
  const flipCard = document.getElementById("the-flip-card");
  const front = document.getElementById("card-front-face");
  const back = document.getElementById("card-back-face");

  flipCard.classList.remove("flipped");
  currentCardSpecies = animal.species;

  const name = capitalize(animal.species);
  const rarityLabel = capitalize(animal.rarity);
  const isVariant = animal.rarity === "variant";
  const sightingCount = cachedSightingCounts[animal.species] || 0;
  const level = levelForSightings(sightingCount, animal.rarity);
  const levelBadge = isVariant ? "No Level" : "LVL " + level;

  front.innerHTML = `
    <div class="card-header-row">
      <div class="card-name">${name}</div>
      <div class="card-rarity-badge rarity-${animal.rarity}">${rarityLabel}</div>
      ${isLocked ? "" : `<div class="card-level-badge">${levelBadge}</div>`}
    </div>
    <div class="card-picture-placeholder" id="card-picture-area">${name}<br>picture</div>
  `;

  loadCardImage(animal.species);

  const isInjured = !isLocked && isSpeciesInjured(animal.species);

  if (isLocked) {
    front.innerHTML += `<div class="card-locked-note">🔒 Locked — keep exploring to find this one</div>`;
    back.innerHTML = "";
  } else {
    front.innerHTML += `<div class="card-class-row">${capitalize(animal.class)}</div>`;

    // Injury is temporary and doesn't erase what you know about the animal —
    // only "locked" (never unlocked, no data) should hide stats.
    if (isInjured) {
      front.innerHTML += `<div class="card-injured-note">✚ Injured — recovering in the hospital</div>`;
    }

    const statCap = STAT_CAP_BY_RARITY[animal.rarity] || 100;
    const currentStats = cachedAnimalStats[animal.species] || animal;
    const neededForNext = sightingsRequiredForNextLevel(sightingCount, animal.rarity);
    const isMaxLevel = !isVariant && neededForNext === 0;

    const attrHtml = ["attack", "defense", "healing"].map(function (stat) {
      const value = Math.min(100, Math.max(0, currentStats[stat]));
      return `
        <div class="card-attr-row">
          <span class="card-attr-name">${capitalize(stat)}</span>
          <div class="card-attr-bar-wrap">
            <div class="card-attr-bar-fill" style="width:${value}%"></div>
            <div class="card-attr-cap-line" style="left:${statCap}%" title="Max for ${rarityLabel}: ${statCap}"></div>
          </div>
          <span class="card-attr-val">${currentStats[stat]}</span>
        </div>
      `;
    }).join("");

    const tilLevelUpHtml = isVariant
      ? ""
      : `
        <div class="card-sighting-block${isMaxLevel ? " card-sighting-maxlevel" : ""}">
          <div class="card-sighting-label">Til Level Up</div>
          <div class="card-sighting-val">${isMaxLevel ? "MAX LEVEL" : neededForNext}</div>
        </div>
      `;

    front.innerHTML += `<button class="card-flip-button" id="flip-to-back-button">Flip to see stats &rarr;</button>`;
    back.innerHTML = `
      <div class="card-back-sightings">
        <div class="card-sighting-block">
          <div class="card-sighting-label">Total Sightings</div>
          <div class="card-sighting-val">${sightingCount}</div>
        </div>
        ${tilLevelUpHtml}
      </div>
      <div class="card-attrs-title">Attributes</div>
      ${attrHtml}
      <button class="card-flip-button" style="margin-top:auto" id="flip-to-front-button">&larr; Flip back</button>
    `;

    document.getElementById("flip-to-back-button").addEventListener("click", function () {
      flipCard.classList.add("flipped");
    });
    document.getElementById("flip-to-front-button").addEventListener("click", function () {
      flipCard.classList.remove("flipped");
    });
  }

  document.getElementById("card-modal").classList.remove("hidden");
}

function closeAnimalCard() {
  document.getElementById("card-modal").classList.add("hidden");
}

document.getElementById("card-modal-backdrop").addEventListener("click", closeAnimalCard);
document.getElementById("card-close-button").addEventListener("click", closeAnimalCard);
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    closeAnimalCard();
    closeRulesModal();
  }
});

function renderAnimalGrid(containerId, animals, isLocked, headingText) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const heading = document.createElement("h3");
  heading.className = "bucket-heading";
  heading.textContent = headingText;
  container.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "animal-grid";
  animals.forEach(function (animal) {
    grid.appendChild(createAnimalChip(animal, isLocked));
  });
  container.appendChild(grid);
}

let animalsData = null;

async function ensureAnimalsLoaded() {
  if (animalsData) {
    return;
  }

  const response = await fetch("animals.csv");
  const text = await response.text();

  const lines = text.trim().split("\n");
  const dataLines = lines.slice(1);

  animalsData = dataLines
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    })
    .map(function (line) {
      const parts = line.split(",");
      return {
        species: parts[0],
        rarity: parts[1],
        class: parts[2],
        attack: Number(parts[3]),
        defense: Number(parts[4]),
        healing: Number(parts[5]),
        starter: parts[6] === "yes",
      };
    });
}

// The highest a single stat can reach for that rarity once the leveling
// system exists — mirrors STAT_CAP_BY_RARITY in baseball_game_attempt3.
// Every stat bar is drawn on a fixed 0-100 scale; this is just where the
// cap line lands on it.
const STAT_CAP_BY_RARITY = {
  common: 50,
  uncommon: 60,
  rare: 75,
  epic: 90,
  legendary: 100,
  variant: 100,
};

// Mirrors functions/_shared/leveling.js — cumulative sightings needed to
// REACH levels 2-5 (the initial catch is level 1 and doesn't count).
// Variant-rarity animals are excluded — they never level up.
const LEVEL_THRESHOLDS = {
  common: [10, 25, 100, 300],
  uncommon: [5, 20, 50, 100],
  rare: [3, 10, 25, 75],
  epic: [2, 5, 10, 25],
  legendary: [1, 3, 5, 10],
};
const MAX_LEVEL = 5;

function levelForSightings(sightings, rarity) {
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

function sightingsRequiredForNextLevel(sightings, rarity) {
  const level = levelForSightings(sightings, rarity);
  if (level === null || level >= MAX_LEVEL) {
    return 0;
  }
  const thresholds = LEVEL_THRESHOLDS[rarity] || LEVEL_THRESHOLDS.common;
  return Math.max(0, thresholds[level - 1] - sightings);
}

// ── Swarms ───────────────────────────────────────────────────────────────

async function fetchSwarms(username) {
  return apiFetch("/swarms/" + username);
}

async function saveSwarmSlot(username, swarmNumber, species) {
  return apiFetch("/swarms/" + username, {
    method: "PUT",
    body: { swarmNumber: swarmNumber, species: species },
  });
}

// Which swarm (other than excludeSwarmNumber) already has this species, if any.
function findSwarmContaining(swarms, species, excludeSwarmNumber) {
  for (const swarmNumber in swarms) {
    if (swarmNumber === excludeSwarmNumber) {
      continue;
    }
    if (swarms[swarmNumber].includes(species)) {
      return swarmNumber;
    }
  }
  return null;
}

async function renderSwarmSlots() {
  const username = localStorage.getItem("loggedInUser");
  const swarms = await fetchSwarms(username);
  const war = getActiveWar();

  document.querySelectorAll(".swarm-slot").forEach(function (slot) {
    const swarmNumber = slot.dataset.swarmNumber;
    const members = swarms[swarmNumber] || [];
    const summaryEl = slot.querySelector(".swarm-slot-summary");
    const locked = !!findLockingBattle(war, username, swarmNumber);

    const summaryText = members.length > 0 ? members.map(capitalize).join(", ") : "Empty";
    summaryEl.textContent = locked ? summaryText + " 🔒 (in battle)" : summaryText;
    slot.classList.toggle("swarm-slot-locked", locked);
  });
}

document.querySelectorAll(".swarm-slot").forEach(function (slot) {
  slot.addEventListener("click", function () {
    openSwarmPicker(slot.dataset.swarmNumber);
  });
});

let pickerSwarmNumber = null;
let pickerSelectedSpecies = [];

function updateSwarmPickerSubtitle() {
  document.getElementById("swarm-picker-subtitle").textContent =
    "Choose up to 3 animals (" + pickerSelectedSpecies.length + "/3 selected).";
}

async function openSwarmPicker(swarmNumber) {
  const username = localStorage.getItem("loggedInUser");

  await loadWarCache();
  const lockingBattle = findLockingBattle(getActiveWar(), username, swarmNumber);
  if (lockingBattle) {
    showInfoPopup("Swarms", "Swarm " + swarmNumber + " is currently in a territory battle and can't be edited until it's resolved.");
    return;
  }

  pickerSwarmNumber = swarmNumber;

  document.getElementById("swarm-picker-title").textContent = "Swarm " + swarmNumber;

  await ensureAnimalsLoaded();
  await refreshCurrentUserCaches(username);
  const swarms = await fetchSwarms(username);

  pickerSelectedSpecies = (swarms[swarmNumber] || []).slice();
  updateSwarmPickerSubtitle();

  const unlockedAnimals = animalsData.filter(function (animal) {
    return isUnlockedForUser(animal);
  });

  const list = document.getElementById("swarm-picker-list");
  list.innerHTML = "";

  unlockedAnimals.forEach(function (animal) {
    const chip = document.createElement("div");
    chip.className = "animal-chip rarity-" + animal.rarity;

    if (isSpeciesInjured(animal.species)) {
      chip.classList.add("picker-unavailable", "injured");
      chip.innerHTML = '<span class="injured-cross">✚</span> ' + capitalize(animal.species) + " (Injured)";
      list.appendChild(chip);
      return;
    }

    const otherSwarmNumber = findSwarmContaining(swarms, animal.species, swarmNumber);

    if (otherSwarmNumber) {
      chip.classList.add("picker-unavailable");
      chip.textContent = capitalize(animal.species) + " (Swarm " + otherSwarmNumber + ")";
      list.appendChild(chip);
      return;
    }

    chip.textContent = capitalize(animal.species);

    if (pickerSelectedSpecies.includes(animal.species)) {
      chip.classList.add("picker-selected");
    }

    chip.addEventListener("click", function () {
      const alreadySelected = pickerSelectedSpecies.includes(animal.species);

      if (alreadySelected) {
        pickerSelectedSpecies = pickerSelectedSpecies.filter(function (species) {
          return species !== animal.species;
        });
        chip.classList.remove("picker-selected");
      } else if (pickerSelectedSpecies.length < 3) {
        pickerSelectedSpecies.push(animal.species);
        chip.classList.add("picker-selected");
      }

      updateSwarmPickerSubtitle();
    });

    list.appendChild(chip);
  });

  document.getElementById("swarm-picker-overlay").classList.remove("hidden");
}

function closeSwarmPicker() {
  document.getElementById("swarm-picker-overlay").classList.add("hidden");
}

document.getElementById("swarm-picker-save-button").addEventListener("click", async function () {
  const username = localStorage.getItem("loggedInUser");

  await loadWarCache();
  if (findLockingBattle(getActiveWar(), username, pickerSwarmNumber)) {
    showInfoPopup("Swarms", "Swarm " + pickerSwarmNumber + " entered a battle while this was open and can no longer be edited.");
    closeSwarmPicker();
    return;
  }

  const result = await saveSwarmSlot(username, pickerSwarmNumber, pickerSelectedSpecies);

  if (!result.success) {
    showInfoPopup("Swarms", result.message || "Couldn't save this swarm.");
    return;
  }

  await renderSwarmSlots();
  closeSwarmPicker();
});

document.getElementById("swarm-picker-cancel-button").addEventListener("click", closeSwarmPicker);
document.getElementById("swarm-picker-backdrop").addEventListener("click", closeSwarmPicker);

document.getElementById("show-unlocked-button").addEventListener("click", async function () {
  showPanel("unlocked-animals-panel");

  const currentUser = localStorage.getItem("loggedInUser");
  await ensureAnimalsLoaded();
  await refreshCurrentUserCaches(currentUser);

  const unlocked = animalsData.filter(function (animal) {
    return isUnlockedForUser(animal);
  });
  renderAnimalGrid("unlocked-animals-list", unlocked, false, "Unlocked (" + unlocked.length + ")");
});

document.getElementById("show-locked-button").addEventListener("click", async function () {
  showPanel("locked-animals-panel");

  const currentUser = localStorage.getItem("loggedInUser");
  await ensureAnimalsLoaded();
  await refreshCurrentUserCaches(currentUser);

  const locked = animalsData.filter(function (animal) {
    return !isUnlockedForUser(animal);
  });
  renderAnimalGrid("locked-animals-list", locked, true, "Locked (" + locked.length + ")");
});

// ── Daily sightings ──────────────────────────────────────────────────────

let selectedSightingSpecies = [];
let sightingsTimerInterval = null;

function updateSightingsTimer() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const msRemaining = nextMidnight - now;
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  document.getElementById("sightings-timer").textContent =
    "Next daily sightings can be logged in " + hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");

  if (msRemaining <= 0) {
    clearInterval(sightingsTimerInterval);
    sightingsTimerInterval = null;
    renderSightingsPanel();
  }
}

async function renderSightingsPanel() {
  const currentUser = localStorage.getItem("loggedInUser");

  await ensureAnimalsLoaded();
  await refreshCurrentUserCaches(currentUser);
  const log = cachedDailyLog;

  const grid = document.getElementById("sightings-grid");
  const submitButton = document.getElementById("sightings-submit-button");
  const subtitleEl = document.getElementById("sightings-subtitle");
  const timerEl = document.getElementById("sightings-timer");

  if (log.loggedSpecies.length >= 3) {
    grid.classList.add("hidden");
    submitButton.classList.add("hidden");
    subtitleEl.classList.add("hidden");
    timerEl.classList.remove("hidden");

    if (!sightingsTimerInterval) {
      updateSightingsTimer();
      sightingsTimerInterval = setInterval(updateSightingsTimer, 1000);
    }
    return;
  }

  if (sightingsTimerInterval) {
    clearInterval(sightingsTimerInterval);
    sightingsTimerInterval = null;
  }

  // A user might log sightings in more than one visit the same day — the cap
  // is 3 total per day, not 3 per visit, so the remaining slots (and the
  // selection cap below) account for how many they've already logged today.
  const remainingSlots = 3 - log.loggedSpecies.length;
  if (selectedSightingSpecies.length > remainingSlots) {
    selectedSightingSpecies = selectedSightingSpecies.slice(0, remainingSlots);
  }

  timerEl.classList.add("hidden");
  grid.classList.remove("hidden");
  submitButton.classList.remove("hidden");
  subtitleEl.classList.remove("hidden");
  subtitleEl.textContent = "Select up to " + remainingSlots + " more animal" + (remainingSlots === 1 ? "" : "s") +
    " you spotted today (" + selectedSightingSpecies.length + "/" + remainingSlots + " selected).";

  grid.innerHTML = "";

  animalsData.forEach(function (animal) {
    const isLocked = !isUnlockedForUser(animal);
    const alreadyLoggedToday = log.loggedSpecies.includes(animal.species);

    const chip = document.createElement("div");
    chip.className = "animal-chip rarity-" + animal.rarity + (isLocked ? " locked" : "");

    if (alreadyLoggedToday) {
      chip.classList.add("picker-unavailable");
      chip.innerHTML = (isLocked ? "🔒 " : "") + capitalize(animal.species) + " (Logged today)";
      grid.appendChild(chip);
      return;
    }

    chip.innerHTML = (isLocked ? "🔒 " : "") + capitalize(animal.species);
    if (selectedSightingSpecies.includes(animal.species)) {
      chip.classList.add("picker-selected");
    }

    chip.addEventListener("click", function () {
      const alreadySelected = selectedSightingSpecies.includes(animal.species);

      if (alreadySelected) {
        selectedSightingSpecies = selectedSightingSpecies.filter(function (species) {
          return species !== animal.species;
        });
        chip.classList.remove("picker-selected");
      } else if (selectedSightingSpecies.length < remainingSlots) {
        selectedSightingSpecies.push(animal.species);
        chip.classList.add("picker-selected");
      }

      subtitleEl.textContent = "Select up to " + remainingSlots + " more animal" + (remainingSlots === 1 ? "" : "s") +
        " you spotted today (" + selectedSightingSpecies.length + "/" + remainingSlots + " selected).";
    });

    grid.appendChild(chip);
  });
}

document.getElementById("sightings-submit-button").addEventListener("click", async function () {
  if (selectedSightingSpecies.length === 0) {
    return;
  }

  const currentUser = localStorage.getItem("loggedInUser");
  const result = await apiFetch("/sightings/" + currentUser, {
    method: "POST",
    body: { species: selectedSightingSpecies },
  });

  if (!result.success) {
    showInfoPopup("Daily Sightings", result.message || "Something went wrong.");
    return;
  }

  let message = "Thanks for logging your daily sightings!";
  if (result.newlyUnlocked.length > 0) {
    message += " Congratulations, you've unlocked " + result.newlyUnlocked.map(capitalize).join(", ") + "!";
  }
  if (result.levelUps.length > 0) {
    message += " " + result.levelUps.map(function (levelUp) {
      return capitalize(levelUp.species) + " leveled up to level " + levelUp.newLevel + "!";
    }).join(" ");
  }
  showInfoPopup("Daily Sightings", message);

  selectedSightingSpecies = [];
  await renderSightingsPanel();
});

document.getElementById("show-sightings-button").addEventListener("click", async function () {
  showPanel("log-sightings-panel");
  selectedSightingSpecies = [];
  await renderSightingsPanel();
});

// For each sub-page, which panel "Back" should return to.
// A panel mapped to null is a section home screen — Back from there goes to Home.
const PANEL_PARENT = {
  "wars-panel": null,
  "hospital-panel": "wars-panel",
  "animals-home-panel": null,
  "unlocked-animals-panel": "animals-home-panel",
  "locked-animals-panel": "animals-home-panel",
  "log-sightings-panel": "animals-home-panel",
};

document.getElementById("back-button").addEventListener("click", function () {
  const currentPanel = document.querySelector(".content-panel:not(.hidden)");
  const parentPanelId = PANEL_PARENT[currentPanel.id];

  if (parentPanelId) {
    showPanel(parentPanelId);
  } else {
    showScreen("home-screen");
  }
});

const savedUser = localStorage.getItem("loggedInUser");
if (savedUser && getAuthToken()) {
  showHomeScreen(savedUser);
} else {
  showLoginScreen();
}
