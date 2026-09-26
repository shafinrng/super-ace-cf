/* Super Ace — play-money client. Server-authoritative: every outcome,
   balance, bonus-round state and jackpot value comes from the Worker API.
   Test credentials are deliberately NOT pre-filled; there is no purchase
   mechanism anywhere. */
"use strict";

/* ================= config ================= */
const BET_OPTIONS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]; // credits
const AUTO_OPTIONS = [10, 25, 50, 100];
const BASE_STEPS = [1, 2, 3, 5];
const FREE_STEPS = [2, 4, 6, 10];
const SYMBOL_IMG = (s) => `/assets/symbols/symbol-${s.toLowerCase()}.webp`;

const T = () => ({
  land: st.turbo ? 250 : 500,
  flipStagger: st.turbo ? 40 : 80,
  flipDur: st.turbo ? 300 : 550,
  winShow: st.turbo ? 350 : 700,
  remove: st.turbo ? 180 : 300,
  drop: st.turbo ? 320 : 600,
  win: st.turbo ? 350 : 700,
  autoBase: st.turbo ? 400 : 1200,
  autoFree: st.turbo ? 500 : 1000,
  enterStagger: (reel, row) => (st.turbo ? reel * 10 : reel * 40 + row * 15),
  idleDelay: (reel, row) => (reel * 4 + row) * 180,
});

/* ================= state ================= */
const st = {
  token: localStorage.getItem("sa_token") || null,
  username: null,
  balanceCents: 0,
  bet: 1, // credits
  turbo: false,
  autoLeft: 0,
  spinning: false,
  lock: false,
  freeMode: false,
  freeSpinsLeft: 0,
  freeSpinBet: 1,
  jackpots: { GRAND: 0, MAJOR: 0, MINOR: 0, MINI: 0 },
  online: 0,
  fairness: null, // { serverSeedHash, clientSeed, nonce }
  spinDeg: 0,
  ws: null,
  wsUp: false,
};

const DEMO_GRID = Array.from({ length: 5 }, (_, i) =>
  Array.from({ length: 4 }, (_, j) => ["A", "K", "Q", "J"][(i + j) % 4])
);

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const credits = (cents) => (cents / 100).toFixed(2);

/* ================= api ================= */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(st.token ? { Authorization: `Bearer ${st.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && st.token) {
    logout(true);
    throw new Error("Session expired — please log in again.");
  }
  return { ok: res.ok, status: res.status, data };
}

/* ================= auth view ================= */
let authMode = "login";

function showAuth() {
  $("auth-view").classList.remove("hidden");
  $("game-view").classList.add("hidden");
}

function showGame() {
  $("auth-view").classList.add("hidden");
  $("game-view").classList.remove("hidden");
  buildMultiplierBar();
  buildGrid(DEMO_GRID);
  updateChips();
}

function setAuthMessage(msg) {
  $("auth-message").textContent = msg;
}

async function submitAuth() {
  const username = $("auth-username").value.trim();
  const password = $("auth-password").value;
  setAuthMessage("");
  if (!username || !password) {
    setAuthMessage("Enter a username and password.");
    return;
  }
  const btn = $("auth-go");
  btn.disabled = true;
  try {
    const r = await api("POST", `/api/auth/${authMode}`, { username, password });
    if (!r.ok) {
      setAuthMessage(r.data.error || "Something went wrong.");
      return;
    }
    st.token = r.data.token;
    localStorage.setItem("sa_token", st.token);
    await enterGame();
  } catch (e) {
    setAuthMessage(e.message || "Network error.");
  } finally {
    btn.disabled = false;
  }
}

async function enterGame() {
  const me = await api("GET", "/api/auth/me");
  if (!me.ok) throw new Error(me.data.error || "Could not load account.");
  st.username = me.data.user.username;
  st.balanceCents = me.data.user.balanceCents;
  showGame();
  updateWallet();
  connectPresence();

  const state = await api("GET", "/api/game/state");
  if (state.ok) {
    if (state.data.session) st.fairness = state.data.session;
    updateFairPanel();
    if (state.data.bonusRound && state.data.bonusRound.active) {
      // Resume an in-progress bonus round after a reload.
      st.freeMode = true;
      st.freeSpinsLeft = state.data.bonusRound.remaining;
      st.freeSpinBet = state.data.bonusRound.betCents / 100;
      setFreeModeUi(true);
      scheduleNextFreeSpin(1500);
    }
  }
  fetchJackpots();
}

function logout(expired) {
  if (!expired) api("POST", "/api/auth/logout").catch(() => {});
  localStorage.removeItem("sa_token");
  st.token = null;
  st.freeMode = false;
  st.autoLeft = 0;
  if (st.ws) {
    try {
      st.ws.close();
    } catch {}
    st.ws = null;
    st.wsUp = false;
  }
  showAuth();
}

/* ================= wallet / ticker ================= */
function updateWallet(winCents) {
  $("wallet-balance").textContent = credits(st.balanceCents);
  $("wallet-bet").textContent = (st.freeMode ? st.freeSpinBet : st.bet).toFixed(2);
  if (winCents !== undefined) $("wallet-win").textContent = credits(winCents);
}

function updateChips() {
  $("online-count").textContent = `\u25CF ${st.online} online`;
  $("chip-GRAND").textContent = `G ${credits(st.jackpots.GRAND)}`;
  $("chip-MAJOR").textContent = `M ${credits(st.jackpots.MAJOR)}`;
  $("chip-MINOR").textContent = `m ${credits(st.jackpots.MINOR)}`;
  $("chip-MINI").textContent = `\u2022 ${credits(st.jackpots.MINI)}`;
  renderJpDrawer();
}

async function fetchJackpots() {
  try {
    const r = await fetch("/api/jackpots");
    const data = await r.json();
    if (data.ok) {
      for (const tier of Object.keys(st.jackpots)) {
        st.jackpots[tier] = data.tiers[tier].cents;
      }
      updateChips();
    }
  } catch {}
}

/* ================= presence websocket ================= */
function connectPresence() {
  if (!st.token || st.ws) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/presence?token=${st.token}`);
  st.ws = ws;
  ws.onopen = () => {
    st.wsUp = true;
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "presence") {
        st.online = msg.online;
        $("online-count").textContent = `\u25CF ${msg.online} online`;
      } else if (msg.type === "jackpots" && msg.pools) {
        st.jackpots = msg.pools;
        updateChips();
      }
    } catch {}
  };
  ws.onclose = () => {
    st.ws = null;
    st.wsUp = false;
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {}
  };
}

// Polling fallback when the socket is down (e.g. proxies without WS).
setInterval(() => {
  if (st.token && !st.wsUp) fetchJackpots();
}, 5000);

/* ================= multiplier bar ================= */
function buildMultiplierBar() {
  const bar = $("mult-bar");
  bar.innerHTML = "";
  for (const m of st.freeMode ? FREE_STEPS : BASE_STEPS) {
    const el = document.createElement("div");
    el.className = "mult-step";
    el.dataset.m = m;
    el.textContent = `x${m}`;
    bar.appendChild(el);
  }
}

function setMultiplier(current) {
  for (const el of $("mult-bar").children) {
    el.classList.toggle("on", Number(el.dataset.m) <= current);
  }
}

function setFreeModeUi(on) {
  $("grid-frame").classList.toggle("fs-mode", on);
  $("fs-tab").classList.toggle("hidden", !on);
  $("fs-tab-count").textContent = st.freeSpinsLeft;
  $("btn-spin").disabled = on;
  $("spin-overlay-auto").classList.toggle("hidden", !on);
  $("spin-overlay-auto").textContent = on ? "AUTO" : "";
  $("btn-bet-down").disabled = on;
  $("btn-bet-up").disabled = on;
  buildMultiplierBar();
  setMultiplier(st.freeMode ? FREE_STEPS[0] : BASE_STEPS[0]);
  updateWallet();
}

/* ================= grid ================= */
function buildGrid(grid) {
  const el = $("grid");
  el.innerHTML = "";
  for (let row = 0; row < 4; row++) {
    for (let reel = 0; reel < 5; reel++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.cell = `${reel}-${row}`;
      cell.appendChild(makeCard(grid[reel][row], reel, row));
      el.appendChild(cell);
    }
  }
}

function makeCard(symbol, reel, row, opts = {}) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.reel = reel;
  card.dataset.row = row;
  const isScatter = symbol === "SCATTER";
  const isGolden = symbol === "GOLDEN";
  if (isScatter) card.classList.add("scatter");

  if (isGolden) {
    const wrap = document.createElement("div");
    wrap.className = "flip-wrap";
    const flip = document.createElement("div");
    flip.className = "flip";
    const front = document.createElement("img");
    front.src = SYMBOL_IMG("GOLDEN");
    const back = document.createElement("img");
    back.src = SYMBOL_IMG("WILD");
    back.className = "back";
    const shimmer = document.createElement("div");
    shimmer.className = "shimmer";
    const s1 = document.createElement("div");
    s1.className = "sparkle";
    s1.style.top = "18%";
    s1.style.left = "22%";
    const s2 = document.createElement("div");
    s2.className = "sparkle s2";
    s2.style.bottom = "22%";
    s2.style.right = "18%";
    flip.append(front, shimmer, s1, s2, back);
    wrap.appendChild(flip);
    card.appendChild(wrap);
  } else if (isScatter) {
    const glow = document.createElement("div");
    glow.className = "scatter-glow";
    const img = document.createElement("img");
    img.src = SYMBOL_IMG("SCATTER");
    img.className = "sym scatter-img";
    card.append(glow, img);
  } else {
    const img = document.createElement("img");
    img.src = SYMBOL_IMG(symbol);
    img.className = "sym";
    card.appendChild(img);
  }

  if (opts.entering) {
    card.classList.add("enter");
    card.style.transitionDelay = `${opts.delay}ms`;
    card.classList.add("idle");
    card.style.animationDelay = `${opts.idleDelay}ms`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        card.classList.add("settled");
        card.style.transitionDelay = "0ms";
      })
    );
  }
  return card;
}

function cellCard(reel, row) {
  return document.querySelector(`[data-cell="${reel}-${row}"] .card`);
}

function markCells(cells, cls) {
  for (const [reel, row] of cells) {
    const c = cellCard(reel, row);
    if (c) c.classList.add(cls);
  }
}

function clearMarks() {
  for (const c of document.querySelectorAll("#grid .card")) {
    c.classList.remove("winning", "dim", "removing");
  }
}

function highlightWins(wins) {
  const positions = wins.flatMap((w) => w.positions);
  markCells(positions, "winning");
  for (const c of document.querySelectorAll("#grid .card")) {
    if (!c.classList.contains("winning") && positions.length > 0) c.classList.add("dim");
  }
}

async function animateSpin(result) {
  const t = T();

  // 1. Land the grid (staggered drop-in).
  for (const cell of document.querySelectorAll("#grid .cell")) {
    const [reel, row] = cell.dataset.cell.split("-").map(Number);
    cell.replaceChildren(makeCard(result.landedGrid[reel][row], reel, row, { entering: true, delay: t.enterStagger(reel, row), idleDelay: t.idleDelay(reel, row) }));
  }
  await delay(t.land);

  // 2. Golden card flips.
  if (result.goldenPositions.length > 0) {
    for (const [reel, row] of result.goldenPositions) {
      const flip = cellCard(reel, row)?.querySelector(".flip");
      if (flip) setTimeout(() => flip.classList.add("flipped"), 50);
    }
    await delay((result.goldenPositions.length - 1) * t.flipStagger + t.flipDur);
  }

  // 3. Initial wins.
  clearMarks();
  if (result.wins.length > 0) {
    highlightWins(result.wins);
    await delay(t.winShow);
  }

  // 4. Cascades.
  let step = 0;
  for (const cascade of result.cascades) {
    step++;
    markCells(cascade.removedPositions, "removing");
    await delay(t.remove);

    // Replace removed cells with the refilled grid.
    const removed = new Set(cascade.removedPositions.map(([r, w]) => `${r}-${w}`));
    for (let row = 0; row < 4; row++) {
      for (let reel = 0; reel < 5; reel++) {
        if (!removed.has(`${reel}-${row}`)) continue;
        const cell = document.querySelector(`[data-cell="${reel}-${row}"]`);
        cell.replaceChildren(makeCard(cascade.newGrid[reel][row], reel, row, { entering: true, delay: 0, idleDelay: t.idleDelay(reel, row) }));
        const card = cell.firstChild;
        card.classList.remove("enter");
        card.classList.add("dropping");
        requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("settled")));
      }
    }
    setMultiplier(cascade.multiplier);
    await delay(t.drop);

    clearMarks();
    if (cascade.wins.length > 0) {
      highlightWins(cascade.wins);
      await delay(t.win);
    }
  }
  return step;
}

/* ================= popups ================= */
function popup(html, autoCloseMs) {
  const layer = $("popup-layer");
  layer.classList.remove("hidden");
  layer.innerHTML = html;
  if (autoCloseMs) {
    setTimeout(() => {
      layer.classList.add("hidden");
      layer.innerHTML = "";
    }, autoCloseMs);
  }
}

function closePopups() {
  const layer = $("popup-layer");
  layer.classList.add("hidden");
  layer.innerHTML = "";
}

function showWinPopup(amount, combo) {
  popup(
    `<div class="popup-dim" style="background:rgba(0,0,0,0.5)"></div>` +
      `<div class="win-banner"><div class="win-label">TOTAL WIN</div>` +
      (combo > 0 ? `<div class="combo-label">COMBO ${combo}</div>` : ``) +
      `</div><div class="popup-center"><div class="gold-number">${amount.toFixed(2)}</div></div>`,
    2500
  );
}

function showFreeSpinsWon(count) {
  popup(
    `<div class="popup-dim" style="background:rgba(0,0,0,0.75)"></div>` +
      `<div class="popup-center"><div class="popup-box"><div class="popup-small-label">SCATTER BONUS</div>` +
      `<div class="popup-big-label">FREE SPINS WON</div><div class="popup-count">${count}</div></div></div>`,
    2800
  );
}

function showRetrigger(amount) {
  popup(
    `<div class="popup-center"><div class="popup-box retrigger-box">` +
      `<div class="popup-small-label">RETRIGGER</div>` +
      `<div class="popup-big-label">+${amount} SPINS</div></div></div>`,
    1800
  );
}

function showFreeSpinsComplete(totalWin) {
  popup(
    `<div class="popup-dim" style="background:rgba(0,0,0,0.75)"></div>` +
      `<div class="popup-center"><div class="popup-box"><div class="popup-small-label">FREE SPINS COMPLETE</div>` +
      `<div style="font-size:12px;color:#e8d9b0;letter-spacing:0.1em;margin-top:6px">TOTAL BONUS WIN</div>` +
      `<div class="gold-number" style="font-size:64px">${totalWin.toFixed(2)}</div></div></div>`,
    3200
  );
}

function showJackpotBanner(tier, amountCents) {
  popup(
    `<div class="popup-dim" style="background:rgba(0,0,0,0.75)"></div>` +
      `<div class="popup-center"><div class="jackpot-banner"><div class="jackpot-tier">JACKPOT</div>` +
      `<div class="popup-big-label" style="-webkit-text-stroke-color:#7f1d1d">${tier}</div>` +
      `<div class="popup-count">${credits(amountCents)}</div></div></div>`,
    3200
  );
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("game-view").firstElementChild.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ================= fairness ================= */
function updateFairPanel(revealedSeed) {
  if (st.fairness) {
    $("fair-hash").textContent = st.fairness.serverSeedHash;
    $("fair-client").textContent = st.fairness.clientSeed;
    $("fair-nonce").textContent = st.fairness.nonce;
  }
  if (revealedSeed) {
    $("fair-revealed").textContent = `Previous server seed revealed: ${revealedSeed}`;
  }
}

/* ================= spin flow ================= */
function setSpinning(on) {
  st.spinning = on;
  $("btn-spin").classList.toggle("spinning", on);
  $("spin-img").style.transition = on ? "transform 0.8s ease" : "transform 0.2s ease";
}

function setAutoOverlay() {
  const overlay = $("spin-overlay-auto");
  if (st.freeMode) {
    overlay.classList.remove("hidden");
    overlay.textContent = "AUTO";
  } else if (st.autoLeft > 0) {
    overlay.classList.remove("hidden");
    overlay.textContent = st.autoLeft;
  } else {
    overlay.classList.add("hidden");
  }
}

async function doSpin(isFreeSpin) {
  if (st.spinning || st.lock) return;
  if (!isFreeSpin && st.freeMode) return;
  st.lock = true;
  setSpinning(true);
  closePopups();
  clearMarks();
  st.spinDeg += 1080;
  $("spin-img").style.transform = `translate(-50%, -50%) rotate(${st.spinDeg}deg)`;

  try {
    const body = isFreeSpin ? {} : { betCents: Math.round(st.bet * 100) };
    const r = await api("POST", "/api/game/spin", body);
    if (!r.ok) {
      toast(r.data.error || "Spin failed.", "error");
      return;
    }
    const d = r.data;
    st.balanceCents = d.balanceCents;
    st.fairness = d.fairness;
    updateFairPanel();
    if (d.jackpot.pools) {
      st.jackpots = d.jackpot.pools;
      updateChips();
    }

    const combo = await animateSpin(d.spin);
    const totalWin = d.winCents + d.jackpot.winCents;
    updateWallet(totalWin);

    if (d.jackpot.tier) {
      showJackpotBanner(d.jackpot.tier, d.jackpot.winCents);
      await delay(3200);
    }

    if (d.winCents > 0 || d.jackpot.winCents > 0) {
      showWinPopup(totalWin / 100, combo);
    }

    const b = d.bonusRound;
    if (!isFreeSpin && b.triggered) {
      // Fresh trigger from a base spin.
      st.freeMode = true;
      st.freeSpinsLeft = b.remaining;
      st.freeSpinBet = st.bet;
      setFreeModeUi(true);
      await delay(600);
      showFreeSpinsWon(b.remaining);
      await delay(2800);
      closePopups();
    } else if (isFreeSpin) {
      if (b.retriggered > 0) {
        st.freeSpinsLeft = b.remaining;
        showRetrigger(b.retriggered);
        await delay(1800);
        closePopups();
      }
      st.freeSpinsLeft = b.remaining;
      $("fs-tab-count").textContent = st.freeSpinsLeft;
      if (b.completed) {
        st.freeMode = false;
        setFreeModeUi(false);
        showFreeSpinsComplete(b.totalWinCents / 100);
        await delay(3200);
        closePopups();
      }
    }
  } catch (e) {
    toast(e.message || "Network error.", "error");
  } finally {
    setSpinning(false);
    setAutoOverlay();
    updateWallet();
    st.lock = false;
    if (st.freeMode) scheduleNextFreeSpin(400);
  }
}

function scheduleNextFreeSpin(ms) {
  if (!st.freeMode || st.spinning) return;
  const t = T().autoFree;
  setTimeout(() => {
    if (st.freeMode && !st.spinning && !st.lock) doSpin(true);
  }, Math.max(ms, t));
}

/* ================= panels ================= */
function buildBetPanel() {
  const wrap = $("bet-options");
  wrap.innerHTML = "";
  for (const b of BET_OPTIONS) {
    const btn = document.createElement("button");
    btn.className = "sheet-opt" + (b === st.bet ? " selected" : "");
    btn.textContent = b.toFixed(2);
    btn.onclick = () => {
      st.bet = b;
      updateWallet();
      $("bet-panel").classList.add("hidden");
    };
    wrap.appendChild(btn);
  }
}

function buildAutoPanel() {
  const wrap = $("auto-options");
  wrap.innerHTML = "";
  for (const n of AUTO_OPTIONS) {
    const btn = document.createElement("button");
    btn.className = "sheet-opt purple";
    btn.textContent = `${n}x`;
    btn.onclick = () => {
      st.autoLeft = n;
      setAutoOverlay();
      $("auto-panel").classList.add("hidden");
      if (!st.spinning && !st.freeMode) doSpin(false);
    };
    wrap.appendChild(btn);
  }
}

function renderJpDrawer() {
  const list = $("jp-drawer-list");
  if (!list) return;
  const colors = { GRAND: "#ef4444", MAJOR: "#f59e0b", MINOR: "#3b82f6", MINI: "#10b981" };
  list.innerHTML = "";
  for (const tier of Object.keys(colors)) {
    const item = document.createElement("div");
    item.className = "jp-drawer-item";
    item.style.border = `1px solid ${colors[tier]}`;
    item.innerHTML = `<div class="tier" style="color:${colors[tier]}">${tier}</div>` +
      `<div class="val">${credits(st.jackpots[tier])}</div>`;
    list.appendChild(item);
  }
}

function changeBet(dir) {
  if (st.freeMode) return;
  const idx = BET_OPTIONS.indexOf(st.bet);
  const next = idx + dir;
  if (next >= 0 && next < BET_OPTIONS.length) {
    st.bet = BET_OPTIONS[next];
    updateWallet();
    buildBetPanel();
  }
}

/* ================= wiring ================= */
function wire() {
  $("tab-login").onclick = () => {
    authMode = "login";
    $("tab-login").classList.add("active");
    $("tab-register").classList.remove("active");
    $("auth-go").textContent = "LOGIN TO PLAY";
    setAuthMessage("");
  };
  $("tab-register").onclick = () => {
    authMode = "register";
    $("tab-register").classList.add("active");
    $("tab-login").classList.remove("active");
    $("auth-go").textContent = "CREATE ACCOUNT";
    setAuthMessage("");
  };
  $("auth-go").onclick = submitAuth;
  for (const id of ["auth-username", "auth-password"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAuth();
    });
  }

  $("btn-spin").onclick = () => {
    if (st.freeMode) return;
    if (st.autoLeft > 0) {
      st.autoLeft = 0;
      setAutoOverlay();
      return;
    }
    doSpin(false);
  };
  $("btn-turbo").onclick = () => {
    st.turbo = !st.turbo;
    $("btn-turbo").classList.toggle("turbo-on", st.turbo);
  };
  $("btn-bet-down").onclick = () => changeBet(-1);
  $("btn-bet-up").onclick = () => changeBet(1);
  $("btn-auto").onclick = () => {
    if (st.freeMode) return;
    $("auto-panel").classList.remove("hidden");
  };
  $("wallet-bet-cell").onclick = () => {
    if (!st.freeMode) {
      buildBetPanel();
      $("bet-panel").classList.remove("hidden");
    }
  };
  $("btn-topup").onclick = async () => {
    const btn = $("btn-topup");
    btn.disabled = true;
    try {
      const r = await api("POST", "/api/wallet/topup");
      if (r.ok) {
        st.balanceCents = r.data.balanceCents;
        updateWallet();
        toast(`Free top-up +${r.data.granted} credits`, "success");
      } else {
        toast(r.data.error || "Top-up unavailable.", "error");
      }
    } catch {
      toast("Network error.", "error");
    } finally {
      btn.disabled = false;
    }
  };
  $("btn-logout").onclick = () => logout(false);

  $("jp-tab").onclick = () => {
    renderJpDrawer();
    $("jp-drawer").classList.remove("hidden");
  };
  $("jp-close").onclick = () => $("jp-drawer").classList.add("hidden");

  $("btn-fair").onclick = () => {
    updateFairPanel();
    $("fair-panel").classList.remove("hidden");
  };
  $("fair-rotate").onclick = async () => {
    const r = await api("POST", "/api/game/session", {});
    if (r.ok) {
      st.fairness = r.data.session;
      updateFairPanel(r.data.previousServerSeed);
    } else {
      toast(r.data.error || "Rotate failed.", "error");
    }
  };

  for (const id of ["bet-panel", "auto-panel"]) {
    $(id).onclick = (e) => {
      if (e.target.id === id) $(id).classList.add("hidden");
    };
  }
}

async function init() {
  wire();
  buildBetPanel();
  buildAutoPanel();
  setMultiplier(BASE_STEPS[0]);
  if (st.token) {
    try {
      await enterGame();
      return;
    } catch {
      logout(true);
    }
  }
  showAuth();
}

init();
