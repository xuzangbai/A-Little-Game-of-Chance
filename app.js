"use strict";

const byId = (id) => document.getElementById(id);
const chambersInput = byId("chamber-count");
const bulletsInput = byId("bullet-count");
const shotsInput = byId("shot-count");
const trialsInput = byId("trial-count");
const settingsError = byId("settings-error");
const batchError = byId("batch-error");
const cover = byId("cover");
const reloadButton = byId("reload");
const spinButton = byId("spin");
const fireButton = byId("fire");
const batchButton = byId("batch");
const canvas = byId("cylinder");
const activeHole = byId("active-hole");
const ctx = canvas.getContext("2d");
const legend = document.querySelector(".legend");
const shotProgress = byId("shot-progress");
const roundStatus = byId("round-status");
const resultsPanel = byId("results");
const showManualLogButton = byId("show-manual-log");
const showBatchLogButton = byId("show-batch-log");
const showResultsButton = byId("show-results");
const hideResultsButton = byId("hide-results");
const manualResult = byId("manual-result");
const outcomeSymbol = byId("outcome-symbol");
const resultMessage = byId("result-message");
const resultDetail = byId("result-detail");
const manualLog = byId("manual-log");
const batchLog = byId("batch-log");
const emptyRecords = byId("empty-records");
const batchStatus = byId("batch-status");
const batchProgress = byId("batch-progress");
const completedCount = byId("completed-count");
const deathCount = byId("death-count");
const deathRate = byId("death-rate");

const settingsInputs = [chambersInput, bulletsInput, shotsInput];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const numberFormat = new Intl.NumberFormat("zh-CN");
const TAU = 2 * Math.PI;
const WIDTH = 560;
const HEIGHT = 450;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 223;
const FACE_RADIUS = 166;
const CHAMBER_RADIUS = 108;
const MAX_LOG_ROWS = 120;
const ROWS_PER_TICK = 5;
const COAST_DECELERATION = 0.000004;
const MAX_COAST_MS = 6000;
const ALIGN_MS = 115;
const RANDOM_SPAN = 2 ** 32;
const randomWords = new Uint32Array(128);
let randomCursor = randomWords.length;

let config;
let loaded;
let round;
let batchRun = null;
let toastTimer = 0;
let selectedLog = manualLog;

const wheel = { angle: 0, hole: 0, animating: false, drag: null };
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

function randomIndex(length) {
  const limit = RANDOM_SPAN - RANDOM_SPAN % length;
  let word;
  do {
    if (randomCursor === randomWords.length) {
      crypto.getRandomValues(randomWords);
      randomCursor = 0;
    }
    word = randomWords[randomCursor++];
  } while (word >= limit);
  return word % length;
}

function parsePositiveInteger(value) {
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return null;
  const integer = BigInt(digits);
  return integer > 0n ? integer : null;
}

function inputError(input, output, message) {
  input.setAttribute("aria-invalid", "true");
  output.textContent = message;
  output.hidden = false;
  return null;
}

function readSettings() {
  for (const input of settingsInputs) input.removeAttribute("aria-invalid");
  settingsError.hidden = true;

  const chambers = Number(chambersInput.value);
  const maximum = Number(chambersInput.max);
  if (!Number.isInteger(chambers) || chambers < 1 || chambers > maximum) {
    return inputError(chambersInput, settingsError, "总孔数须为 1 到 " + maximum + " 的整数。");
  }

  bulletsInput.max = chambers;
  const bullets = Number(bulletsInput.value);
  if (bulletsInput.value === "" || !Number.isInteger(bullets) || bullets < 0 || bullets > chambers) {
    return inputError(bulletsInput, settingsError, "装弹数须为 0 到 " + chambers + " 的整数。");
  }

  const shots = parsePositiveInteger(shotsInput.value);
  if (shots === null) {
    return inputError(shotsInput, settingsError, "每轮击发次数须为正整数。");
  }

  return { chambers, bullets, shots };
}

function sampleSlots(slotCount, count) {
  const slots = Array.from({ length: slotCount }, (_, index) => index);
  for (let index = 0; index < count; index++) {
    const other = index + randomIndex(slotCount - index);
    [slots[index], slots[other]] = [slots[other], slots[index]];
  }
  return new Set(slots.slice(0, count));
}

function syncSettings(forceReload = false) {
  const next = readSettings();
  if (!next) return false;

  if (!forceReload && config
      && next.chambers === config.chambers && next.bullets === config.bullets && next.shots === config.shots) {
    return true;
  }

  config = next;
  loaded = sampleSlots(config.chambers, config.bullets);
  wheel.angle = 0;
  wheel.hole = 0;
  resetRound();
  drawModel();
  updateControls();
  return true;
}

function resetRound(message = "待击发") {
  round = { fired: 0n, over: false };
  updateRound(message);
}

function updateRound(message, tone = "") {
  shotProgress.textContent = numberFormat.format(round.fired) + " / " + numberFormat.format(config.shots);
  roundStatus.textContent = message;
  roundStatus.dataset.tone = tone;
}

function updateControls() {
  const motion = wheel.animating || wheel.drag !== null;
  const active = batchRun !== null;
  const locked = motion || active;
  activeHole.textContent = motion ? "—" : String(wheel.hole + 1);
  for (const input of settingsInputs) input.disabled = locked;
  canvas.setAttribute("aria-disabled", String(locked));
  spinButton.disabled = locked;
  reloadButton.disabled = locked;
  fireButton.disabled = locked || round.over;
  batchButton.disabled = motion;
  trialsInput.disabled = active;
}

function disc(x, y, radius, fill) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ring(x, y, radius, color, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function sheen(x, y, radius, stops) {
  const gradient = ctx.createLinearGradient(x - radius * 0.6, y - radius, x + radius * 0.6, y + radius);
  for (const [position, color] of stops) gradient.addColorStop(position, color);
  return gradient;
}

function drawHousing() {
  ctx.save();
  ctx.shadowColor = "#06090e";
  ctx.shadowBlur = 31;
  ctx.shadowOffsetY = 17;
  disc(0, 0, 185, "#151b20");
  ctx.restore();

  disc(0, 0, 186, sheen(0, 0, 186, [[0, "#55676a"], [0.46, "#252f37"], [1, "#11171e"]]));
  ring(0, 0, 186, "#77898a55");
  disc(0, 0, 177, "#141c22");
  ring(0, 0, 177, "#080e13", 3);

  for (let index = 0; index < 60; index++) {
    const angle = index * TAU / 60;
    const outer = index % 5 === 0 ? 200 : 196;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 191, Math.sin(angle) * 191);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.strokeStyle = index % 5 === 0 ? "#84989986" : "#74868749";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawSlot(index, radius) {
  const angle = index * TAU / config.chambers - Math.PI / 2;
  const x = Math.cos(angle) * CHAMBER_RADIUS;
  const y = Math.sin(angle) * CHAMBER_RADIUS;
  const isLoaded = loaded.has(index);
  disc(x, y, radius + Math.min(4, radius * 0.24),
    sheen(x, y, radius, [[0, "#172228"], [0.47, "#34444a"], [1, "#849698"]]));
  disc(x, y, radius, sheen(x, y, radius, [[0, "#090e12"], [0.7, "#131d23"], [1, "#263139"]]));

  if (isLoaded) {
    disc(x, y, radius * 0.86, sheen(x, y, radius,
      [[0, "#fae0a3"], [0.29, "#d9ad6d"], [0.58, "#946439"], [1, "#e9bd79"]]));
    if (radius >= 5) {
      ring(x, y, radius * 0.69, "#fce3a789", 1);
      ring(x, y, radius * 0.52, "#7951329b", 1);
      disc(x, y, radius * 0.31, sheen(x, y, radius * 0.31, [[0, "#ac7350"], [1, "#e8c49a"]]));
      ring(x, y, radius * 0.31, "#734d31", 1);
    }
  }

  if (config.chambers <= 24) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#d2dbd7";
    ctx.fillText(String(index + 1), Math.cos(angle) * 151, Math.sin(angle) * 151);
  }
}

function drawLid() {
  disc(0, 0, 158, sheen(0, 0, 158, [[0, "#45575c"], [0.36, "#303e45"], [1, "#1a252e"]]));
  ring(0, 0, 156, "#95a8a26b", 1.5);
  ring(0, 0, 145, "#73878657");
  ring(0, 0, 141, "#1c282e");
  ring(0, 0, 69, "#82918d41");

  const screwCount = 6;
  for (let index = 0; index < screwCount; index++) {
    const angle = index * TAU / screwCount;
    const x = 132 * Math.cos(angle);
    const y = 132 * Math.sin(angle);
    disc(x, y, 4, "#1d282f");
    ring(x, y, 4, "#80918d85");
  }

  ctx.save();
  ctx.rotate(-wheel.angle);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.fillStyle = "#c2d3ce";
  ctx.fillText("遮挡中", 0, 94);
  ctx.restore();
}

function drawFace() {
  ctx.save();
  ctx.rotate(wheel.angle);

  disc(0, 0, FACE_RADIUS + 5, sheen(0, 0, FACE_RADIUS,
    [[0, "#a1b1ac"], [0.21, "#63777a"], [0.59, "#293940"], [0.88, "#6f8382"], [1, "#354249"]]));
  ring(0, 0, FACE_RADIUS + 4, "#a3b8b49e", 1.5);
  disc(0, 0, FACE_RADIUS - 5, sheen(0, 0, FACE_RADIUS,
    [[0, "#53676d"], [0.41, "#34464e"], [0.68, "#28393f"], [1, "#45565a"]]));
  ring(0, 0, FACE_RADIUS - 7, "#141e24", 1.4);

  if (cover.checked) {
    drawLid();
  } else {
    const spacing = config.chambers === 1 ? 42 : Math.sin(Math.PI / config.chambers) * CHAMBER_RADIUS;
    const radius = Math.min(34, spacing * 0.72);
    for (let index = 0; index < config.chambers; index++) drawSlot(index, radius);
  }

  disc(0, 0, 45, "#18252d");
  ring(0, 0, 46, "#87989385");
  disc(0, 0, 39, sheen(0, 0, 39, [[0, "#899c98"], [0.31, "#4b5d61"], [0.7, "#253741"], [1, "#536967"]]));
  ring(0, 0, 34, "#a0b0aa57", 1.5);
  disc(0, 0, 21, "#26363f");
  ring(0, 0, 21, "#adbbb184", 1.2);
  disc(0, 0, 11, sheen(0, 0, 11, [[0, "#81978f"], [1, "#4a5b5e"]]));
  ctx.fillStyle = "#344850";
  ctx.fillRect(-7, -1.3, 14, 2.6);

  ctx.restore();
}

function drawMarker() {
  ctx.beginPath();
  ctx.moveTo(-9, -204);
  ctx.lineTo(9, -204);
  ctx.lineTo(0, -186);
  ctx.closePath();
  ctx.fillStyle = "#a9e2d4";
  ctx.fill();
}

function drawModel() {
  if (!ctx || !config) return;
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.translate(CENTER_X, CENTER_Y);
  drawHousing();
  drawFace();
  drawMarker();
  ctx.restore();
}

function resizeModel() {
  const scale = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(bounds.width * scale));
  canvas.height = Math.max(1, Math.round(bounds.height * scale));
  drawModel();
}

function animateMotion(duration, angleAt, after) {
  wheel.animating = true;
  const startedAt = performance.now();
  updateControls();

  function frame(now) {
    const elapsed = reduceMotion.matches ? duration : Math.max(0, Math.min(duration, now - startedAt));
    wheel.angle = angleAt(elapsed);
    if (elapsed < duration) {
      drawModel();
      requestAnimationFrame(frame);
      return;
    }
    wheel.angle = modulo(wheel.angle, TAU);
    wheel.animating = false;
    after();
    drawModel();
    updateControls();
  }

  requestAnimationFrame(frame);
}

function animateWheel(target, duration, after) {
  const start = wheel.angle;
  animateMotion(duration, (elapsed) => {
    const remaining = 1 - elapsed / duration;
    return start + (target - start) * (1 - remaining ** 4);
  }, after);
}

function spinWheel() {
  const nextHole = randomIndex(config.chambers);
  const slotAngle = TAU / config.chambers;
  const distanceToHole = modulo(-nextHole * slotAngle - wheel.angle, TAU);
  const target = wheel.angle + (1 + randomIndex(2)) * TAU + distanceToHole;

  resetRound("转动中…");
  animateWheel(target, 789 + randomIndex(111), () => {
    wheel.hole = nextHole;
    updateRound("待击发");
    recordManual("随机转动", "", holeLabel(wheel.hole));
  });
}

function coastWheel(velocity) {
  const startAngle = wheel.angle;
  const coastMs = Math.min(Math.abs(velocity) / COAST_DECELERATION, MAX_COAST_MS);
  const restAngle = startAngle + velocity * coastMs / 2;
  const slotAngle = TAU / config.chambers;
  const stop = Math.round(restAngle / slotAngle);
  const target = stop * slotAngle;

  resetRound("转动中…");
  animateMotion(coastMs + ALIGN_MS, (elapsed) => {
    if (elapsed < coastMs) {
      return startAngle + velocity * elapsed * (1 - elapsed / (2 * coastMs));
    }
    const progress = Math.min(1, (elapsed - coastMs) / ALIGN_MS);
    const eased = progress * progress * (3 - 2 * progress);
    return restAngle + (target - restAngle) * eased;
  }, () => {
    wheel.hole = modulo(-stop, config.chambers);
    updateRound("待击发");
    const speed = Math.abs(velocity) * 1000 / TAU;
    const direction = velocity < 0 ? "逆时针" : "顺时针";
    const motion = velocity === 0 ? "松手时静止" : direction + " " + speed.toFixed(2) + " 圈/秒";
    recordManual("拖动弹巢", motion, holeLabel(wheel.hole));
  });
}

function canSpin() {
  return !wheel.animating && !wheel.drag && !batchRun && syncSettings();
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * WIDTH / bounds.width - CENTER_X;
  const y = (event.clientY - bounds.top) * HEIGHT / bounds.height - CENTER_Y;
  return { x, y, angle: Math.atan2(y, x) };
}

function beginDrag(event) {
  if (event.button !== 0 || !canSpin()) return;

  const point = pointerPosition(event);
  const distance = Math.hypot(point.x, point.y);
  if (distance > FACE_RADIUS + 15) return;
  event.preventDefault();

  const time = performance.now();
  wheel.drag = {
    id: event.pointerId,
    point,
    swipe: distance < 63,
    movement: 0,
    velocity: 0,
    lastSample: time,
    lastMovement: time
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
  updateControls();
}

function moveDrag(event) {
  const drag = wheel.drag;
  if (!drag || drag.id !== event.pointerId) return;
  if (event.pointerType === "mouse" && event.buttons === 0) {
    endDrag(event);
    return;
  }

  const point = pointerPosition(event);
  const now = performance.now();
  const angularChange = modulo(point.angle - drag.point.angle + Math.PI, TAU) - Math.PI;
  const change = drag.swipe ? (point.x - drag.point.x - (point.y - drag.point.y) * 0.35) / 80 : angularChange;
  if (Math.abs(change) > 0.001) {
    drag.velocity = change / Math.max(5, now - drag.lastSample);
    drag.movement += Math.abs(change);
    drag.lastMovement = now;
    wheel.angle += change;
    drawModel();
  }
  drag.point = point;
  drag.lastSample = now;
}

function endDrag(event) {
  const drag = wheel.drag;
  if (!drag || (event.type !== "blur" && drag.id !== event.pointerId)) return;

  wheel.drag = null;
  canvas.classList.remove("is-dragging");
  if (event.type === "pointerup" && drag.movement > 0.045) {
    const isStale = performance.now() - drag.lastMovement > 85;
    coastWheel(isStale ? 0 : drag.velocity);
  } else {
    wheel.angle = -wheel.hole * TAU / config.chambers;
    drawModel();
    updateControls();
  }
}

function holeLabel(hole) {
  return "第 " + (hole + 1) + " 孔";
}

function closeResults() {
  clearTimeout(toastTimer);
  if (resultsPanel.contains(document.activeElement)) showResultsButton.focus();
  showResultsButton.setAttribute("aria-expanded", "false");
  resultsPanel.hidden = true;
  manualResult.hidden = true;
}

function refreshSelectedLog() {
  emptyRecords.hidden = selectedLog.childElementCount > 0 || (selectedLog === batchLog && batchRun !== null);
  if (!resultsPanel.hidden) selectedLog.scrollTop = selectedLog.scrollHeight;
}

function selectLog(log) {
  clearTimeout(toastTimer);
  selectedLog = log;
  const showManual = log === manualLog;
  showManualLogButton.setAttribute("aria-pressed", String(showManual));
  showBatchLogButton.setAttribute("aria-pressed", String(!showManual));
  manualLog.hidden = !showManual;
  batchLog.hidden = showManual;
  if (!showManual) manualResult.hidden = true;
  refreshSelectedLog();
}

function openResults(log = selectedLog) {
  resultsPanel.hidden = false;
  showResultsButton.hidden = false;
  showResultsButton.setAttribute("aria-expanded", "true");
  selectLog(log);
}

function appendLog(log, rows) {
  log.append(rows);
  while (log.children.length > MAX_LOG_ROWS) log.firstElementChild.remove();
  if (log === selectedLog) refreshSelectedLog();
}

function recordManual(action, detail, outcome, hit = false) {
  appendLog(manualLog, makeLogRow(action, detail, outcome, hit));
  showResultsButton.hidden = false;
  if (resultsPanel.hidden) selectLog(manualLog);
}

function showShot(hit, hole) {
  const shot = "第 " + numberFormat.format(round.fired) + " 发";
  const chamber = holeLabel(hole);
  const outcome = hit ? "你死了" : "空仓";
  recordManual("击发 · " + shot, chamber, outcome, hit);
  manualResult.dataset.hit = String(hit);
  outcomeSymbol.textContent = hit ? "!" : "○";
  resultMessage.textContent = outcome;
  resultDetail.textContent = shot + " · " + chamber;
  manualResult.hidden = false;
  openResults(manualLog);
  toastTimer = setTimeout(closeResults, 3600);
}

function fire() {
  if (wheel.animating || wheel.drag || batchRun || !syncSettings() || round.over) return;

  const hole = wheel.hole;
  const hit = loaded.has(hole);
  round.fired += 1n;
  round.over = hit || round.fired === config.shots;
  showShot(hit, hole);

  if (round.over) {
    updateRound(hit ? "本轮命中实弹" : "本轮全部空仓", hit ? "hit" : "clear");
    updateControls();
    return;
  }

  updateRound("上一发空仓", "clear");
  const nextHole = (hole + 1) % config.chambers;
  animateWheel(wheel.angle - TAU / config.chambers, 245, () => {
    wheel.hole = nextHole;
  });
}

function sampleTrial({ chambers, bullets, shotLimit }) {
  if (bullets === 0) return 0;

  // Each miss removes one empty hole from the candidates for the next shot.
  for (let shot = 0; shot < shotLimit; shot++) {
    if (randomIndex(chambers - shot) < bullets) return shot + 1;
  }
  return 0;
}

function makeLogRow(label, description, result, hit) {
  const row = document.createElement("li");
  const action = document.createElement("span");
  const detail = document.createElement("span");
  const outcome = document.createElement("strong");
  row.classList.toggle("is-hit", hit);
  action.textContent = label;
  detail.textContent = description;
  outcome.textContent = result;
  row.append(action, detail, outcome);
  return row;
}

function percentage(part, total) {
  return Number(part * 10000n / total) / 100;
}

function updateBatchStats(run) {
  completedCount.textContent = numberFormat.format(run.completed);
  deathCount.textContent = numberFormat.format(run.hits);
  deathRate.textContent = run.completed ? percentage(run.hits, run.completed).toFixed(2) + "%" : "—";
  batchProgress.firstElementChild.style.width = run.target ? percentage(run.completed, run.target) + "%" : "";
}

function endBatch(run, stopped) {
  clearTimeout(run.timer);
  batchRun = null;
  updateBatchStats(run);
  batchProgress.dataset.continuous = "false";
  batchStatus.textContent = stopped ? "已停止" : "已完成";
  batchButton.textContent = "开始";
  batchButton.classList.replace("button-stop", "button-primary");
  updateControls();
}

function tickBatch(run) {
  const rows = document.createDocumentFragment();
  for (let index = 0; index < ROWS_PER_TICK && run.completed !== run.target; index++) {
    const hitAt = sampleTrial(run);
    run.completed += 1n;
    if (hitAt) run.hits += 1n;
    const label = "#" + numberFormat.format(run.completed);
    const detail = hitAt ? "第 " + hitAt + " 发命中" : "全部空仓";
    rows.append(makeLogRow(label, detail, hitAt ? "你死了" : "通过", hitAt > 0));
  }

  appendLog(batchLog, rows);

  if (run.completed === run.target) {
    endBatch(run, false);
  } else {
    const now = performance.now();
    if (now - run.lastUpdate >= 90) {
      updateBatchStats(run);
      run.lastUpdate = now;
    }
    run.timer = setTimeout(() => tickBatch(run), 16);
  }
}

function startOrStopBatch() {
  if (batchRun) {
    endBatch(batchRun, true);
    return;
  }
  if (wheel.animating || wheel.drag || !syncSettings()) return;

  const input = trialsInput.value.trim();
  const target = input ? parsePositiveInteger(input) : null;
  if (input && target === null) {
    inputError(trialsInput, batchError, "测试轮数须为正整数，留空可持续测试。");
    trialsInput.focus();
    return;
  }

  trialsInput.removeAttribute("aria-invalid");
  batchError.hidden = true;
  const { chambers, bullets, shots } = config;
  const shotLimit = shots >= BigInt(chambers) ? chambers : Number(shots);
  const run = { target, chambers, bullets, shotLimit, completed: 0n, hits: 0n, timer: 0, lastUpdate: 0 };
  batchRun = run;
  batchStatus.textContent = target ? "测试中 · 共 " + numberFormat.format(target) + " 轮" : "持续测试中…";
  batchProgress.dataset.continuous = String(target === null);
  batchButton.textContent = "停止";
  batchButton.classList.replace("button-primary", "button-stop");
  updateBatchStats(run);
  updateControls();

  batchLog.replaceChildren();
  openResults(batchLog);
  run.timer = setTimeout(() => tickBatch(run), 0);
}

for (const input of settingsInputs) input.addEventListener("change", () => syncSettings());
reloadButton.addEventListener("click", () => syncSettings(true));
spinButton.addEventListener("click", () => { if (canSpin()) spinWheel(); });
fireButton.addEventListener("click", fire);
batchButton.addEventListener("click", startOrStopBatch);
trialsInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") startOrStopBatch();
});
trialsInput.addEventListener("input", () => {
  trialsInput.removeAttribute("aria-invalid");
  batchError.hidden = true;
});
cover.addEventListener("change", () => {
  legend.style.visibility = cover.checked ? "hidden" : "";
  drawModel();
});
canvas.addEventListener("pointerdown", beginDrag);
window.addEventListener("pointermove", moveDrag);
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", endDrag);
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (canSpin()) spinWheel();
  }
});
showResultsButton.addEventListener("click", () => openResults());
showManualLogButton.addEventListener("click", () => selectLog(manualLog));
showBatchLogButton.addEventListener("click", () => selectLog(batchLog));
hideResultsButton.addEventListener("click", closeResults);
resultsPanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeResults();
});

syncSettings(true);
new ResizeObserver(resizeModel).observe(canvas);
resizeModel();
