const PRIZES = [
  1, 5, 10, 20, 30, 40, 50, 100, 250, 500, 750,
  1000, 2000, 3000, 4000, 5000, 10000, 20000, 35000, 100000, 250000, 1000000
];

const ROUND_PLAN = [5, 3, 3, 3, 3, 3];

const BONUS_LABELS = ["23А", "23Б", "23В", "23Г", "23Д"];
const BONUS_MODIFIERS = ["НИШТО", "ПОЛОВИНА", "ДВОЈНО", "ИСТО", "БОНУС"];
const BANKER_DELAY_MS = 2500;
const DEAL_STATS_KEY = "deal_stats_v1";

const ROUND_CONFIG = {
  1: { k: 0.25, baseMultRange: [0.11, 0.16] },
  2: { k: 0.30, baseMultRange: [0.13, 0.19] },
  3: { k: 0.35, baseMultRange: [0.16, 0.22] },
  4: { k: 0.45, baseMultRange: [0.20, 0.28] },
  5: { k: 0.55, baseMultRange: [0.24, 0.33] },
  6: { k: 0.65, baseMultRange: [0.28, 0.38] }
};

const state = {
  phase: "pickPlayerBox",
  round: 1,
  boxesToOpenInRound: ROUND_PLAN[0],
  boxes: [],
  boxOrder: [],
  playerBox: null,
  latestOpenedBoxId: null,
  lastEliminatedValues: [],
  currentOffer: 0,
  dealAccepted: false,
  takenDealValue: null,
  acceptedDeal: null,
  dealLocked: false,
  modifierBoxes: {},
  pickedModifierLabel: null,
  baseWinnings: null,
  finalWinnings: null,
  endPlayerBoxValue: null,
  endOtherBoxValue: null,
  wantsBonusStage: null,
  isWaitingForBanker: false,
  autosave: true,
  allowSwap: false
};

let bankerDelayTimer = null;

const els = {
  roundText: document.getElementById("roundText"),
  toOpenText: document.getElementById("toOpenText"),
  statusText: document.getElementById("statusText"),
  boxesGrid: document.getElementById("boxesGrid"),
  myBoxIndicator: document.getElementById("myBoxIndicator"),
  playerBoxSlot: document.getElementById("playerBoxSlot"),
  lowList: document.getElementById("lowList"),
  highList: document.getElementById("highList"),
  offerModal: document.getElementById("offerModal"),
  offerBody: document.getElementById("offerBody"),
  acceptBtn: document.getElementById("acceptBtn"),
  declineBtn: document.getElementById("declineBtn"),
  endModal: document.getElementById("endModal"),
  endBody: document.getElementById("endBody"),
  playAgainBtn: document.getElementById("playAgainBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  statsBtn: document.getElementById("statsBtn"),
  statsModal: document.getElementById("statsModal"),
  statsBody: document.getElementById("statsBody"),
  closeStatsBtn: document.getElementById("closeStatsBtn"),
  resetStatsBtn: document.getElementById("resetStatsBtn")
};

function formatMKD(value) {
  return value.toLocaleString("mk-MK").replaceAll(",", ".");
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}


const analytics = {
  currentGame: null,

  loadGames() {
    const raw = localStorage.getItem(DEAL_STATS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveGames(games) {
    localStorage.setItem(DEAL_STATS_KEY, JSON.stringify(games.slice(-200)));
  },

  pushEvent(type, payload = {}) {
    if (!this.currentGame) return;
    this.currentGame.events.push({
      t: Date.now(),
      type,
      ...payload
    });
  },

  startGame() {
    this.currentGame = {
      gameId: `g-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      startedAt: Date.now(),
      events: [],
      openedBoxes: [],
      offers: []
    };
    this.pushEvent("start");
  },

  logOpenBox(boxLabel, value, roundIndex) {
    if (!this.currentGame) return;
    const item = { boxLabel, value, roundIndex, t: Date.now() };
    this.currentGame.openedBoxes.push(item);
    this.pushEvent("open", item);
  },

  logOffer(roundIndex, offerAmount, remainingCount) {
    if (!this.currentGame) return;
    const item = { roundIndex, offerAmount, remainingCount, t: Date.now() };
    this.currentGame.offers.push(item);
    this.pushEvent("offer", item);
  },

  acceptOffer(roundIndex, offerAmount) {
    if (!this.currentGame) return;
    this.currentGame.acceptedDeal = { roundIndex, amount: offerAmount };
    this.pushEvent("accept", { roundIndex, offerAmount });
  },

  bonusDecision(wantsBonus) {
    if (!this.currentGame) return;
    this.currentGame.wantsBonus = Boolean(wantsBonus);
    this.pushEvent("bonusDecision", { wantsBonus: Boolean(wantsBonus) });
  },

  pickBonus(bonusLabel, modifier, finalWinnings) {
    if (!this.currentGame) return;
    this.currentGame.bonusPick = { bonusLabel, modifier, finalWinnings };
    this.pushEvent("bonusPick", { bonusLabel, modifier, finalWinnings });
  },

  endGame({ playerBoxValue, baseWinnings, finalWinnings, roundsPlayed }) {
    if (!this.currentGame || this.currentGame.endedAt) return;

    const endedAt = Date.now();
    const acceptedDeal = this.currentGame.acceptedDeal || null;
    const acceptedAmount = acceptedDeal ? acceptedDeal.amount : null;

    const finished = {
      ...this.currentGame,
      endedAt,
      durationSec: Math.max(1, Math.round((endedAt - this.currentGame.startedAt) / 1000)),
      playerBoxValue,
      baseWinnings,
      finalWinnings,
      roundsPlayed,
      accepted: Boolean(acceptedDeal),
      acceptedRound: acceptedDeal ? acceptedDeal.roundIndex : null,
      acceptedAmount,
      wasAcceptBetter: acceptedDeal ? acceptedAmount > playerBoxValue : null
    };

    const games = this.loadGames();
    games.push(finished);
    this.saveGames(games);

    this.currentGame = finished;
  }
};

function renderStats() {
  const games = analytics.loadGames();
  const total = games.length;
  const acceptedGames = games.filter((g) => g.accepted);
  const acceptanceRate = total ? (acceptedGames.length / total) * 100 : 0;

  const avgAccepted = acceptedGames.length
    ? acceptedGames.reduce((sum, g) => sum + (g.acceptedAmount || 0), 0) / acceptedGames.length
    : 0;

  const avgFinal = total
    ? games.reduce((sum, g) => sum + (g.finalWinnings ?? g.baseWinnings ?? 0), 0) / total
    : 0;

  const roundRows = [1, 2, 3, 4, 5, 6].map((r) => {
    const offers = games.flatMap((g) => (g.offers || []).filter((o) => o.roundIndex === r).map((o) => o.offerAmount));
    const avgOffer = offers.length ? offers.reduce((a, b) => a + b, 0) / offers.length : 0;
    return `<tr><td>R${r}</td><td>${offers.length ? `${formatMKD(Math.round(avgOffer))} ден.` : "-"}</td></tr>`;
  }).join("");

  const last10 = [...games].slice(-10).reverse().map((g) => {
    const date = new Date(g.startedAt).toLocaleString("mk-MK");
    const acceptedLabel = g.accepted ? "да" : "не";
    const acceptedAmount = g.accepted ? `${formatMKD(g.acceptedAmount || 0)} ден.` : "-";
    const playerValue = `${formatMKD(g.playerBoxValue || 0)} ден.`;
    const finalValue = `${formatMKD(g.finalWinnings ?? g.baseWinnings ?? 0)} ден.`;
    return `<tr><td>${date}</td><td>${acceptedLabel}</td><td>${acceptedAmount}</td><td>${playerValue}</td><td>${finalValue}</td></tr>`;
  }).join("");

  els.statsBody.innerHTML = `
    <div class="stats-grid">
      <div class="stats-chip"><strong>Вкупно игри</strong><br>${total}</div>
      <div class="stats-chip"><strong>Acceptance rate</strong><br>${acceptanceRate.toFixed(1)}%</div>
      <div class="stats-chip"><strong>Просечен прифатен договор</strong><br>${formatMKD(Math.round(avgAccepted))} ден.</div>
      <div class="stats-chip"><strong>Просечна финална добивка</strong><br>${formatMKD(Math.round(avgFinal))} ден.</div>
    </div>

    <h4>Просечна понуда по рунда</h4>
    <table class="stats-table"><thead><tr><th>Рунда</th><th>Просек</th></tr></thead><tbody>${roundRows}</tbody></table>

    <h4>Последни 10 игри</h4>
    <table class="stats-table">
      <thead><tr><th>Датум</th><th>Прифатено?</th><th>Износ</th><th>Твоја кутија</th><th>Финална добивка</th></tr></thead>
      <tbody>${last10 || '<tr><td colspan="5">Нема податоци.</td></tr>'}</tbody>
    </table>
  `;
}

function initGame(useSaved = true) {
  if (bankerDelayTimer) {
    clearTimeout(bankerDelayTimer);
    bankerDelayTimer = null;
  }

  if (useSaved && loadState()) {
    render();
    return;
  }

  const shuffled = shuffle(PRIZES);
  state.phase = "pickPlayerBox";
  state.round = 1;
  state.boxesToOpenInRound = ROUND_PLAN[0];
  state.playerBox = null;
  state.boxOrder = Array.from({ length: 22 }, (_, idx) => idx + 1);
  state.latestOpenedBoxId = null;
  state.lastEliminatedValues = [];
  state.currentOffer = 0;
  state.dealAccepted = false;
  state.takenDealValue = null;
  state.acceptedDeal = null;
  state.dealLocked = false;
  state.modifierBoxes = {};
  state.pickedModifierLabel = null;
  state.baseWinnings = null;
  state.finalWinnings = null;
  state.endPlayerBoxValue = null;
  state.endOtherBoxValue = null;
  state.wantsBonusStage = null;
  state.isWaitingForBanker = false;

  state.boxes = Array.from({ length: 22 }, (_, idx) => ({
    id: idx + 1,
    value: shuffled[idx],
    opened: false
  }));

  analytics.startGame();

  renderPrizeLadder();
  updateTopUI();
  render();
  saveState();
}

function renderPrizeLadder() {
  const low = PRIZES.slice(0, 11);
  const high = PRIZES.slice(11);

  els.lowList.innerHTML = low
    .map((value) => `<li data-value="${value}">${formatMKD(value)}</li>`)
    .join("");

  els.highList.innerHTML = high
    .map((value) => `<li data-value="${value}">${formatMKD(value)}</li>`)
    .join("");
}

function ensureBoxOrder() {
  const expectedLength = state.playerBox && state.phase !== "pickPlayerBox"
    ? state.boxes.length - 1
    : state.boxes.length;

  if (!Array.isArray(state.boxOrder) || state.boxOrder.length !== expectedLength) {
    state.boxOrder = state.boxes
      .map((box) => box.id)
      .filter((id) => expectedLength === state.boxes.length || id !== state.playerBox);
  }
}

function randomizeOpenableBoxOrder() {
  const idsWithoutPlayer = state.boxes
    .map((box) => box.id)
    .filter((id) => id !== state.playerBox);

  state.boxOrder = shuffle(idsWithoutPlayer);
}

function createBoxButton(box) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "box-btn";
  button.textContent = box.id;
  button.dataset.id = String(box.id);
  button.setAttribute("aria-label", `Кутија ${box.id}`);

  if (box.opened) {
    button.disabled = true;
    button.classList.add("opened");
    if (box.id === state.latestOpenedBoxId) {
      button.classList.add("reveal");
    }
    button.textContent = formatMKD(box.value);
    button.setAttribute("aria-label", `Отворена кутија ${box.id}, ${formatMKD(box.value)} денари`);
  }

  if (state.playerBox === box.id) {
    button.classList.add("player");
    button.setAttribute("aria-label", `Твоја кутија ${box.id}`);
  }

  button.addEventListener("click", () => handleBoxClick(box.id));
  return button;
}

function renderBoxes() {
  els.boxesGrid.innerHTML = "";
  ensureBoxOrder();

  const showPlayerOnStage = state.phase === "pickPlayerBox";

  state.boxOrder.forEach((boxId) => {
    const box = state.boxes.find((entry) => entry.id === boxId);
    if (!box) return;
    if (!showPlayerOnStage && box.id === state.playerBox) return;

    const button = createBoxButton(box);

    if (state.playerBox === box.id && state.phase !== "pickPlayerBox") {
      button.disabled = true;
    }

    els.boxesGrid.appendChild(button);
  });
}

function renderPlayerBoxSlot() {
  els.playerBoxSlot.innerHTML = "";

  if (!state.playerBox || state.phase === "pickPlayerBox") {
    return;
  }

  const playerBox = state.boxes.find((box) => box.id === state.playerBox);
  if (!playerBox) return;

  const button = createBoxButton(playerBox);
  button.disabled = true;
  button.classList.add("player");

  els.playerBoxSlot.appendChild(button);
}

function applyModifier(base, modifier) {
  const safeBase = Math.max(0, Math.trunc(base || 0));

  if (modifier === "НИШТО") return 0;
  if (modifier === "ПОЛОВИНА") return Math.floor(safeBase * 0.5);
  if (modifier === "ДВОЈНО") return safeBase * 2;
  if (modifier === "ИСТО") return safeBase;
  if (modifier === "БОНУС") return safeBase + 10000;

  return safeBase;
}

function ensureModifierBoxes() {
  const keys = Object.keys(state.modifierBoxes || {});
  if (keys.length === BONUS_LABELS.length) return;

  const shuffledModifiers = shuffle(BONUS_MODIFIERS);
  state.modifierBoxes = {};
  BONUS_LABELS.forEach((label, index) => {
    state.modifierBoxes[label] = shuffledModifiers[index];
  });
}

function renderBonusSection() {
  ensureModifierBoxes();

  const buttons = BONUS_LABELS.map((label) => {
    const picked = state.pickedModifierLabel === label;
    const disabled = state.pickedModifierLabel !== null && !picked;
    const modifier = state.modifierBoxes[label];
    const text = picked ? `${label} · ${modifier}` : label;
    return `<button type="button" class="box-btn bonus-btn${picked ? " picked" : ""}" data-bonus-label="${label}" ${disabled ? "disabled" : ""}>${text}</button>`;
  }).join("");

  const resultLines = state.pickedModifierLabel
    ? `<p><strong>Основна добивка:</strong> ${formatMKD(state.baseWinnings)} ден.</p>
       <p><strong>Модификатор:</strong> ${state.modifierBoxes[state.pickedModifierLabel]}</p>
       <p><strong>Финална добивка:</strong> ${formatMKD(state.finalWinnings)} ден.</p>`
    : "";

  return `
    <section class="bonus-section">
      <h4>БОНУС КУТИИ</h4>
      <p>Избери една:</p>
      <div class="bonus-grid">${buttons}</div>
      <div class="bonus-result">${resultLines}</div>
    </section>
  `;
}

function renderFinalStageBody() {
  const playerValue = state.endPlayerBoxValue;
  const otherValue = state.endOtherBoxValue;

  let summary = "";
  if (state.acceptedDeal) {
    const acceptedAmount = state.acceptedDeal.amount;
    const diff = acceptedAmount - playerValue;
    const diffLabel = diff >= 0 ? `+${formatMKD(diff)}` : formatMKD(diff);

    summary = `
      <p><strong>Исход:</strong> понуда прифатена, играно до крај</p>
      <p><strong>Прифатена понуда:</strong> ${formatMKD(acceptedAmount)} ден.</p>
      <p><strong>Вредност во твојата кутија:</strong> ${formatMKD(playerValue)} ден.</p>
      <p><strong>Разлика:</strong> ${diffLabel} ден.</p>
      <p><strong>Другата кутија:</strong> ${otherValue !== null ? `${formatMKD(otherValue)} ден.` : "—"}</p>
    `;
  } else {
    summary = `
      <p><strong>Исход:</strong> без договор</p>
      <p><strong>Твоја кутија:</strong> ${formatMKD(playerValue)} ден.</p>
      <p><strong>Другата кутија:</strong> ${otherValue !== null ? `${formatMKD(otherValue)} ден.` : "—"}</p>
      <p><strong>Добивка:</strong> ${formatMKD(playerValue)} ден.</p>
    `;
  }

  let bonusPart = "";
  if (state.wantsBonusStage === null) {
    bonusPart = `
      <section class="bonus-section">
        <h4>БОНУС ПРАШАЊЕ</h4>
        <p>Дали сакаш да ја играш 23-тата кутија?</p>
        <div class="modal-actions">
          <button type="button" class="action-btn accept" data-bonus-choice="yes">ДА</button>
          <button type="button" class="action-btn decline" data-bonus-choice="no">НЕ</button>
        </div>
      </section>
    `;
  } else if (state.wantsBonusStage) {
    bonusPart = renderBonusSection();
  }

  els.endBody.innerHTML = `${summary}${bonusPart}`;
}

function updateTopUI() {
  els.roundText.textContent = `Рунда ${state.round}`;

  if (state.phase === "pickPlayerBox") {
    els.toOpenText.textContent = "Отвори уште: —";
    els.statusText.textContent = "Избери ја твојата кутија.";
  } else if (state.phase === "openBoxes") {
    els.toOpenText.textContent = `Отвори уште: ${state.boxesToOpenInRound}`;
    els.statusText.textContent = state.isWaitingForBanker
      ? "Рундата заврши..."
      : `Отвори ${state.boxesToOpenInRound} кутии.`;
  } else if (state.phase === "bankerOffer") {
    els.toOpenText.textContent = "Отвори уште: 0";
    els.statusText.textContent = "Банкарот има понуда.";
  } else {
    els.toOpenText.textContent = "Отвори уште: 0";
    els.statusText.textContent = state.phase === "modifierStage" ? "Бонус фаза: избери кутија." : "Играта заврши.";
  }

  els.myBoxIndicator.textContent = `🔒 МОЈА КУТИЈА: ${state.playerBox ? `#${state.playerBox}` : "—"}`;
}

function handleBoxClick(id) {
  const box = state.boxes.find((b) => b.id === id);
  if (!box) return;

  if (state.phase === "pickPlayerBox") {
    state.playerBox = id;
    randomizeOpenableBoxOrder();
    state.lastEliminatedValues = [];
    state.phase = "openBoxes";
    updateTopUI();
    render();
    saveState();
    return;
  }

  if (state.phase !== "openBoxes") return;
  if (state.isWaitingForBanker) return;
  if (id === state.playerBox || box.opened) return;

  box.opened = true;
  state.latestOpenedBoxId = id;
  state.lastEliminatedValues.push(box.value);
  state.boxesToOpenInRound -= 1;
  eliminatePrize(box.value);
  analytics.logOpenBox(String(id), box.value, state.round);

  if (state.boxesToOpenInRound <= 0) {
    if (state.isWaitingForBanker) return;

    state.isWaitingForBanker = true;
    updateTopUI();
    render();
    saveState();

    bankerDelayTimer = setTimeout(() => {
      bankerDelayTimer = null;
      state.isWaitingForBanker = false;
      state.phase = "bankerOffer";
      state.currentOffer = calculateOffer();
      analytics.logOffer(state.round, state.currentOffer, getRemainingBoxes().length);
      showOfferModal();
      updateTopUI();
      render();
      saveState();
    }, BANKER_DELAY_MS);
    return;
  }

  updateTopUI();
  render();
  saveState();
}

function eliminatePrize(value) {
  const item = document.querySelector(`li[data-value="${value}"]`);
  if (item) item.classList.add("eliminated");
}

function getRemainingBoxes() {
  return state.boxes.filter((b) => !b.opened);
}

function safeNumberArray(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => Number.isFinite(value) && value >= 0);
}

function avg(values) {
  if (!values.length) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function topN(values, n) {
  return [...values].sort((a, b) => b - a).slice(0, Math.max(1, n));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function roundNice(offer, maxRemaining, minRemaining) {
  if (!Number.isFinite(offer)) return minRemaining;

  if (maxRemaining < 250) {
    return Math.min(maxRemaining, Math.max(minRemaining, Math.round(offer)));
  }

  let rounded;
  if (offer < 10000) rounded = Math.round(offer / 250) * 250;
  else if (offer < 50000) rounded = Math.round(offer / 500) * 500;
  else if (offer < 200000) rounded = Math.round(offer / 1000) * 1000;
  else rounded = Math.round(offer / 5000) * 5000;

  if (!Number.isFinite(rounded) || rounded <= 0) {
    rounded = minRemaining;
  }

  return Math.min(maxRemaining, Math.max(minRemaining, rounded));
}

function bankerOffer(roundIndex, remainingValues, lastEliminatedValues) {
  const safeRemaining = safeNumberArray(remainingValues);
  const safeLastEliminated = safeNumberArray(lastEliminatedValues);

  if (!safeRemaining.length || safeRemaining.some((v) => !Number.isFinite(v))) {
    const minRemaining = safeRemaining.length ? Math.min(...safeRemaining) : 250;
    const fallback = Math.max(250, minRemaining);
    console.error("[BANKER ERROR] Invalid inputs, using fallback.", { roundIndex, remainingValues });
    return Math.max(1, Math.trunc(fallback));
  }

  const minRemaining = Math.min(...safeRemaining);
  const maxRemaining = Math.max(...safeRemaining);

  const has1m = safeRemaining.includes(1000000);
  const has250k = safeRemaining.includes(250000);
  const has100k = safeRemaining.includes(100000);
  const has35k = safeRemaining.includes(35000);
  const lost1mThisRound = safeLastEliminated.includes(1000000);

  const EV = avg(safeRemaining);
  const top3Avg = avg(topN(safeRemaining, 3));

  let base = 0;
  const adjustments = [];
  let raw = 0;
  let capUsed = null;

  if (safeRemaining.length === 2) {
    base = EV;
    raw = EV * (0.85 + Math.random() * 0.12);
  } else if (safeRemaining.length === 3) {
    base = EV;
    raw = EV * (0.60 + Math.random() * 0.25);
  } else if (roundIndex === 1) {
    base = has1m
      ? (2400 + Math.random() * 1200)
      : (1500 + Math.random() * 1300);

    if (lost1mThisRound || !has1m) {
      adjustments.push(-1 * (300 + Math.random() * 900));
    }
    if (!has100k && !has250k) {
      adjustments.push(-1 * (200 + Math.random() * 500));
    }
    if (has1m && has250k && has100k) {
      adjustments.push(200 + Math.random() * 500);
    }

    raw = base + adjustments.reduce((sum, v) => sum + v, 0);
    raw = Math.max(500, Math.min(6000, raw));
    capUsed = 6000;
  } else if (roundIndex === 2) {
    base = 3500 + Math.random() * 4000;

    if (has1m) {
      adjustments.push(300 + Math.random() * 1200);
    }
    if (lost1mThisRound || !has1m) {
      adjustments.push(-1 * (600 + Math.random() * 1600));
    }
    if (has250k || has100k) {
      adjustments.push(Math.random() * 900);
    }
    if (!has250k && !has100k && !has35k) {
      adjustments.push(-1 * (200 + Math.random() * 700));
    }

    raw = base + adjustments.reduce((sum, v) => sum + v, 0);
    raw = Math.max(1000, Math.min(14000, raw));
    capUsed = 14000;
  } else {
    // Special Round 4 override: keep offers competitive (not EV-no-brainer) while 1,000,000 is alive.
    if (roundIndex === 4 && has1m) {
      const sortedAsc = [...safeRemaining].sort((a, b) => a - b);
      const top1 = sortedAsc[sortedAsc.length - 1];
      const others = sortedAsc.slice(0, -1);
      const avgOthers = avg(others);
      const mood = Math.random() < 0.70 ? "balanced" : "generous";
      const alpha = mood === "balanced"
        ? (0.028 + Math.random() * (0.040 - 0.028))
        : (0.040 + Math.random() * (0.060 - 0.040));

      const offerBase = avgOthers + alpha * top1;
      const rand = 0.95 + Math.random() * 0.10;
      const penalty = lost1mThisRound ? (0.80 + Math.random() * 0.12) : 1;

      base = offerBase;
      raw = offerBase * rand * penalty;

      const minFloor = Math.max(maxRemaining < 250 ? maxRemaining : 250, minRemaining);
      raw = Math.min(maxRemaining, Math.max(minFloor, raw));

      const finalOffer = Math.trunc(roundNice(raw, maxRemaining, minFloor));
      const safeFinal = Math.max(minFloor, Math.min(maxRemaining, finalOffer));

      console.log("[BANKER DEBUG]", {
        roundIndex,
        mood,
        avgOthers,
        top1,
        alpha,
        offerBase,
        rand,
        penalty,
        finalOffer: safeFinal
      });

      return safeFinal;
    }

    const kByRound = { 3: 0.30, 4: 0.45, 5: 0.55, 6: 0.65 };
    const multByRound = {
      3: [0.18, 0.32],
      4: [0.35, 0.55],
      5: [0.50, 0.75],
      6: [0.75, 0.95]
    };

    const k = kByRound[roundIndex] ?? 0.65;
    const weightedEV = EV + k * (top3Avg - EV);
    const [mMin, mMax] = multByRound[roundIndex] ?? multByRound[6];
    const mult = mMin + Math.random() * (mMax - mMin);

    base = weightedEV;
    raw = weightedEV * mult;

    if (lost1mThisRound || !has1m) {
      raw *= 0.80 + Math.random() * 0.12;
    }

    if (roundIndex === 3) {
      const allTopFourAlive = has1m && has250k && has100k && has35k;
      capUsed = allTopFourAlive ? 35000 : 14000;
    }
  }

  if (capUsed !== null) {
    raw = Math.min(raw, capUsed);
  }

  if (maxRemaining < 1000) {
    const integerOffer = Math.round(raw);
    const finalOffer = clamp(integerOffer, minRemaining, maxRemaining);

    console.log("[BANKER DEBUG]", {
      roundIndex,
      minRemaining,
      maxRemaining,
      EV,
      rawOffer: raw,
      integerOffer,
      finalOffer
    });

    return finalOffer;
  }

  let minAllowed = maxRemaining < 250 ? maxRemaining : 250;
  if (roundIndex >= 4 || safeRemaining.length <= 3) {
    minAllowed = Math.max(minAllowed, minRemaining);
  }

  raw = clamp(raw, minAllowed, maxRemaining);

  const finalOffer = Math.trunc(roundNice(raw, maxRemaining, minAllowed));

  console.log("[BANKER DEBUG]", {
    roundIndex,
    has1m,
    has250k,
    has100k,
    lost1mThisRound,
    base,
    adjustments,
    raw,
    capUsed,
    finalOffer
  });

  return clamp(finalOffer, minAllowed, maxRemaining);
}

function calculateOffer() {
  const roundIndex = state.round;
  const remainingValues = getRemainingBoxes().map((box) => box.value);
  const lastEliminatedValues = state.lastEliminatedValues;
  const offer = bankerOffer(roundIndex, remainingValues, lastEliminatedValues);
  return offer;
}

function showOfferModal() {
  els.offerBody.textContent = `Банкарот нуди: ${formatMKD(state.currentOffer)} ден.`;
  els.acceptBtn.disabled = state.dealLocked;
  els.acceptBtn.textContent = state.dealLocked ? "ПРИФАТЕНО" : "ПРИФАТИ";
  els.declineBtn.textContent = state.dealLocked ? "ПРОДОЛЖИ" : "ОДБИЈ";
  els.offerModal.classList.remove("hidden");
  (state.dealLocked ? els.declineBtn : els.acceptBtn).focus();
}

function hideOfferModal() {
  els.offerModal.classList.add("hidden");
}

function continueAfterOffer() {
  hideOfferModal();

  const rem = getRemainingBoxes();
  if (rem.length === 2) {
    openEndWithoutDeal();
    return;
  }

  state.round += 1;
  state.lastEliminatedValues = [];
  state.isWaitingForBanker = false;
  state.phase = "openBoxes";
  state.boxesToOpenInRound = ROUND_PLAN[state.round - 1] ?? 0;

  updateTopUI();
  render();
  saveState();
}

function afterOfferDeclined() {
  continueAfterOffer();
}

function openEndWithoutDeal() {
  const rem = getRemainingBoxes();
  const player = rem.find((b) => b.id === state.playerBox) || state.boxes.find((b) => b.id === state.playerBox);
  const other = rem.find((b) => b.id !== state.playerBox);

  state.phase = "modifierStage";
  hideOfferModal();

  if (other) other.opened = true;
  if (player) player.opened = true;

  state.endPlayerBoxValue = player ? player.value : 0;
  state.endOtherBoxValue = other ? other.value : null;
  state.baseWinnings = state.acceptedDeal ? state.acceptedDeal.amount : state.endPlayerBoxValue;
  state.finalWinnings = null;
  state.pickedModifierLabel = null;
  state.wantsBonusStage = null;
  ensureModifierBoxes();

  render();
  renderFinalStageBody();

  els.endModal.classList.remove("hidden");
  updateTopUI();
  saveState();
}

function acceptDeal() {
  if (!state.dealLocked) {
    state.acceptedDeal = {
      roundIndex: state.round,
      amount: state.currentOffer
    };
    state.dealLocked = true;
    state.dealAccepted = true;
    state.takenDealValue = state.currentOffer;
    analytics.acceptOffer(state.round, state.currentOffer);
  }

  continueAfterOffer();
}

function render() {
  renderBoxes();
  renderPlayerBoxSlot();

  document.querySelectorAll(".prize-column li").forEach((item) => {
    const val = Number(item.dataset.value);
    const stillIn = state.boxes.some((b) => !b.opened && b.value === val);
    if (!stillIn) item.classList.add("eliminated");
  });

  if (state.phase !== "bankerOffer") hideOfferModal();
  state.latestOpenedBoxId = null;
}

function isAscendingOrder(order) {
  if (!Array.isArray(order)) return false;
  if (order.length < 2) return false;
  return order.every((id, idx) => idx === 0 || order[idx - 1] < id);
}

function saveState() {
  if (!state.autosave) return;
  localStorage.setItem("seIliNestoStateMK", JSON.stringify(state));
}

function loadState() {
  if (!state.autosave) return false;

  const raw = localStorage.getItem("seIliNestoStateMK") || localStorage.getItem("seIliNestoState");
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.boxes) || parsed.boxes.length !== 22) return false;
    Object.assign(state, parsed);
    if (typeof state.wantsBonusStage === "undefined") state.wantsBonusStage = null;
    if (state.isWaitingForBanker) state.isWaitingForBanker = false;

    if (state.playerBox && state.phase !== "pickPlayerBox" && isAscendingOrder(state.boxOrder)) {
      randomizeOpenableBoxOrder();
    }

    renderPrizeLadder();
    updateTopUI();
    if (state.phase === "end") {
      els.endBody.innerHTML = "<p>Зачувана игра завршена. Започни нова игра.</p>";
      els.endModal.classList.remove("hidden");
    }
    if (state.phase === "modifierStage") {
      ensureModifierBoxes();
      renderFinalStageBody();
      els.endModal.classList.remove("hidden");
    }
    if (state.phase === "bankerOffer") showOfferModal();
    return true;
  } catch {
    return false;
  }
}

els.endBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (state.phase !== "modifierStage") return;

  const bonusChoice = target.dataset.bonusChoice;
  if (bonusChoice === "yes") {
    state.wantsBonusStage = true;
    analytics.bonusDecision(true);
    renderFinalStageBody();
    saveState();
    return;
  }

  if (bonusChoice === "no") {
    state.wantsBonusStage = false;
    analytics.bonusDecision(false);
    analytics.endGame({
      playerBoxValue: state.endPlayerBoxValue,
      baseWinnings: state.baseWinnings,
      finalWinnings: state.baseWinnings,
      roundsPlayed: state.round
    });
    renderFinalStageBody();
    saveState();
    return;
  }

  const label = target.dataset.bonusLabel;
  if (!label) return;
  if (!state.wantsBonusStage) return;
  if (state.pickedModifierLabel) return;

  const modifier = state.modifierBoxes[label];
  if (!modifier) return;

  state.pickedModifierLabel = label;
  state.finalWinnings = applyModifier(state.baseWinnings, modifier);
  analytics.pickBonus(label, modifier, state.finalWinnings);
  analytics.endGame({
    playerBoxValue: state.endPlayerBoxValue,
    baseWinnings: state.baseWinnings,
    finalWinnings: state.finalWinnings,
    roundsPlayed: state.round
  });
  renderFinalStageBody();
  saveState();
});

els.acceptBtn.addEventListener("click", acceptDeal);
els.declineBtn.addEventListener("click", afterOfferDeclined);
els.playAgainBtn.addEventListener("click", () => {
  els.endModal.classList.add("hidden");
  initGame(false);
});
els.newGameBtn.addEventListener("click", () => {
  if (confirm("Сигурно сакаш нова игра?")) {
    els.endModal.classList.add("hidden");
    initGame(false);
  }
});


els.statsBtn.addEventListener("click", () => {
  renderStats();
  els.statsModal.classList.remove("hidden");
});

els.closeStatsBtn.addEventListener("click", () => {
  els.statsModal.classList.add("hidden");
});

els.resetStatsBtn.addEventListener("click", () => {
  if (confirm("Сигурно сакаш да ја избришеш статистиката?")) {
    localStorage.removeItem(DEAL_STATS_KEY);
    renderStats();
  }
});

window.addEventListener("beforeunload", saveState);

initGame(true);
