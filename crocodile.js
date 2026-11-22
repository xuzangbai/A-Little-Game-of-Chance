"use strict";

(() => {
  const gameButtons = [...document.querySelectorAll(".game-switcher [data-game]")];
  const revolver = byId("revolver-game");
  const revolverActions = byId("revolver-actions");
  const crocodileGame = byId("crocodile-game");

  for (const button of gameButtons) {
    button.addEventListener("click", () => {
      const showRevolver = button.dataset.game === "revolver";
      if (!showRevolver) closeResults();
      revolver.hidden = !showRevolver;
      revolverActions.hidden = !showRevolver;
      crocodileGame.hidden = showRevolver;
      for (const choice of gameButtons) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
    });
  }

  const minTeeth = 2;
  const maxTeeth = 12;
  const defaultTeeth = 10;
  const crocodile = byId("crocodile");
  const teethContainer = byId("croc-teeth");
  const playerCountInput = byId("croc-player-count");
  const toothCountInput = byId("croc-tooth-count");
  const trapCountInput = byId("croc-trap-count");
  const status = byId("croc-status");
  const turnText = byId("croc-turn");
  const outcome = byId("croc-outcome");
  const progress = byId("croc-progress");
  const restart = byId("croc-restart");
  let teeth = [];
  let round;

  function setCountOptions(select, min, max, selected) {
    const choices = [];
    for (let count = min; count <= max; count++) choices.push(new Option(count, count));
    select.replaceChildren(...choices);
    select.value = String(Math.min(max, Math.max(min, selected)));
  }

  function updateToothSettings() {
    const toothCount = Number(toothCountInput.value) || defaultTeeth;
    toothCountInput.value = String(toothCount);
    setCountOptions(trapCountInput, 1, toothCount - 1, Number(trapCountInput.value) || 1);
    startRound();
  }

  function startRound() {
    const toothCount = Number(toothCountInput.value);
    const trapCount = Number(trapCountInput.value) || 1;
    trapCountInput.value = String(trapCount);
    if (teeth.length !== toothCount) {
      teeth = Array.from({ length: toothCount }, (_, index) => createTooth(index, toothCount));
      teethContainer.style.setProperty("--tooth-count", String(toothCount));
      teethContainer.replaceChildren(...teeth);
    }
    round = { traps: sampleSlots(toothCount, trapCount), player: 1, pressed: 0, ended: false };
    crocodile.classList.remove("is-closed");
    status.classList.remove("is-loss");
    turnText.textContent = "轮到玩家 1";
    outcome.hidden = true;
    progress.textContent = "0 / " + toothCount;
    restart.textContent = "新一轮";

    for (const tooth of teeth) {
      tooth.disabled = false;
      delete tooth.dataset.state;
    }
  }

  function pressTooth(tooth, index, fromKeyboard) {
    if (round.ended || tooth.disabled) return;

    round.pressed += 1;
    progress.textContent = round.pressed + " / " + teeth.length;
    tooth.disabled = true;

    if (round.traps.has(index)) {
      round.ended = true;
      tooth.dataset.state = "trap";
      crocodile.classList.add("is-closed");
      status.classList.add("is-loss");
      turnText.textContent = "玩家 " + round.player + " 被咬到了";
      outcome.textContent = "按中第 " + (index + 1) + " 颗机关牙";
      outcome.hidden = false;
      restart.textContent = "再来一轮";
      for (const remaining of teeth) remaining.disabled = true;
      if (fromKeyboard) restart.focus();
      return;
    }

    tooth.dataset.state = "pressed";
    round.player = round.player % Number(playerCountInput.value) + 1;
    turnText.textContent = "轮到玩家 " + round.player;
    if (fromKeyboard) {
      const next = teeth.slice(index + 1).find((button) => !button.disabled)
        ?? teeth.find((button) => !button.disabled);
      next.focus();
    }
  }

  function createTooth(index, toothCount) {
    const tooth = document.createElement("button");
    const toothFace = document.createElement("span");
    const center = (toothCount - 1) / 2;
    const centerOffset = (index - center) * Math.min(1, 4.5 / center);
    tooth.type = "button";
    tooth.className = "croc-tooth";
    tooth.setAttribute("aria-label", "按第 " + (index + 1) + " 颗牙");
    tooth.style.setProperty("--tooth-rise", -0.24 * centerOffset ** 2 + "cqw");
    tooth.style.setProperty("--tooth-tilt", centerOffset * 2.4 + "deg");
    toothFace.setAttribute("aria-hidden", "true");
    tooth.append(toothFace);
    tooth.addEventListener("click", (event) => pressTooth(tooth, index, event.detail === 0));
    return tooth;
  }

  toothCountInput.addEventListener("change", updateToothSettings);
  trapCountInput.addEventListener("change", startRound);
  playerCountInput.addEventListener("change", startRound);
  restart.addEventListener("click", (event) => {
    startRound();
    if (event.detail === 0) teeth[0].focus();
  });
  setCountOptions(toothCountInput, minTeeth, maxTeeth, defaultTeeth);
  updateToothSettings();
})();
