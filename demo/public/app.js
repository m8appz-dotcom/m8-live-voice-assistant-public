import {
  $,
  $$,
  esc,
  load,
  save,
  draw,
  modal,
  notify,
  download,
  access,
  wireAccess,
} from "./core.js";
import { voiceExamples } from "./data.js";
const valid = (s) =>
  Array.isArray(s) &&
  s.length <= 100 &&
  s.every(
    (t) =>
      t &&
      typeof t.question === "string" &&
      typeof t.answer === "string" &&
      ["complete", "interrupted"].includes(t.status),
  );
let turns = load("voice", [], valid),
  selected = 0,
  state = "ready",
  position = 0,
  display = "",
  timer = null,
  current = null;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const labels = {
  ready: "Ready",
  replaying: "Replaying",
  paused: "Paused",
  interrupted: "Interrupted",
  complete: "Complete",
};
function stopTimer() {
  clearInterval(timer);
  timer = null;
}
function commit(status) {
  if (!current) return;
  const turn = { question: current.question, answer: display, status };
  if (turns.length >= 100) turns = turns.slice(-99);
  turns.push(turn);
  save("voice", turns);
  current = null;
}
function tick() {
  const parts = voiceExamples[selected].answer.split(" ");
  position = Math.min(position + 1, parts.length);
  display = parts.slice(0, position).join(" ");
  const reply = $("#reply-text");
  if (reply) reply.textContent = display;
  if (position === parts.length) {
    stopTimer();
    state = "complete";
    commit("complete");
    render();
  }
}
function play() {
  stopTimer();
  if (current) commit("interrupted");
  current = voiceExamples[selected];
  display = "";
  position = 0;
  state = "replaying";
  render();
  if (reduced) {
    display = current.answer;
    state = "complete";
    commit("complete");
    render();
  } else timer = setInterval(tick, 75);
}
function interrupt() {
  if (!current) return;
  stopTimer();
  state = "interrupted";
  commit("interrupted");
  render();
  notify("Replay stopped. The transcript keeps only the text shown.");
}
function render() {
  const example = voiceExamples[selected];
  draw(
    `<main class="voice-shell state-${state === "replaying" ? 2 : state === "ready" ? 0 : 1}" id="main"><header class="voice-header"><strong>M8 <span>LIVE</span></strong><span class="voice-session">Conversation explorer / 01</span>${access()}</header><div class="voice-stage"><div class="voice-routes" aria-hidden="true"><svg viewBox="0 0 700 600" fill="none"><path class="route violet" d="M-60 80 H150 Q200 80 200 130 V390 Q200 440 250 440 H410 Q460 440 460 390 V300 Q460 250 510 250 H740"/><path class="route mint" d="M-60 230 H300 Q350 230 350 280 V480 Q350 530 400 530 H740"/><path class="route coral" d="M-60 360 H100 Q150 360 150 310 V190 Q150 140 200 140 H510 Q560 140 560 190 V340 Q560 390 610 390 H740"/><circle class="signal-dot" cx="350" cy="230" r="14" fill="#e5ff88"/></svg><span class="route-label l1">Your question</span><span class="route-label l2">Context</span><span class="route-label l3">Reply</span></div><section class="voice-message"><p class="voice-state-caption"><span class="voice-dot"></span><span role="status">${labels[state]}</span><span class="mono">0${selected + 1}</span></p><h1>${state === "ready" ? "Where shall we start?" : state === "interrupted" ? "Your turn." : state === "paused" ? "Take your time." : "A reply, with context."}</h1><div class="voice-last-turn"><span>${state === "ready" ? "CHOOSE A QUESTION" : "EXAMPLE CONVERSATION"}</span><p>${esc(example.question)}</p>${state !== "ready" ? `<p id="reply-text" class="voice-reply">${esc(display)}</p>` : ""}<button data-transcript>Read transcript (${turns.length}) ↗</button></div></section></div><div class="voice-control-bar"><div class="voice-states" role="group" aria-label="Text replay controls">${state === "replaying" ? "<button data-pause>Ⅱ Pause replay</button><button data-interrupt>■ Interrupt</button>" : state === "paused" ? "<button data-resume>↗ Resume replay</button><button data-interrupt>■ Interrupt</button>" : `<button data-play>↗ ${state === "ready" ? "Start text replay" : "Replay response"}</button>`}<button data-export ${!turns.length ? "disabled" : ""}>Export transcript ↓</button></div><p>Authored text replay · no microphone or live model</p></div><section class="voice-example-picker" aria-label="Example questions">${voiceExamples.map((ex, i) => `<button data-question="${i}" aria-pressed="${selected === i}"><span class="mono">0${i + 1}</span>${esc(ex.question)}</button>`).join("")}</section><footer class="voice-footer"><span>${labels[state].toUpperCase()}</span><span>M8 LIVE / ENGLISH</span></footer></main>`,
    () => {
      $$("[data-question]").forEach(
        (b) =>
          (b.onclick = () => {
            if (current) {
              stopTimer();
              commit("interrupted");
            }
            selected = Number(b.dataset.question);
            state = "ready";
            display = "";
            render();
          }),
      );
      $("[data-play]")?.addEventListener("click", play);
      $("[data-pause]")?.addEventListener("click", () => {
        stopTimer();
        state = "paused";
        render();
      });
      $("[data-resume]")?.addEventListener("click", () => {
        state = "replaying";
        render();
        timer = setInterval(tick, 75);
      });
      $("[data-interrupt]")?.addEventListener("click", interrupt);
      $("[data-export]").onclick = () =>
        download("m8-example-transcript.json", {
          kind: "authored-text-replay",
          language: "en",
          microphone_used: false,
          live_model_used: false,
          turns,
        });
      $("[data-transcript]").onclick = () => {
        modal(
          "Conversation transcript",
          `${turns.length ? turns.map((t, i) => `<article class="transcript-turn"><span class="mono">${String(i + 1).padStart(2, "0")} · ${esc(t.status)}</span><h3>You</h3><p>${esc(t.question)}</p><h3>M8</h3><p>${esc(t.answer) || "Replay stopped before the first word."}</p></article>`).join("") : "<p>No completed turns yet. Start a text replay to explore the example.</p>"}${turns.length ? '<button class="text-button" data-clear>Clear transcript</button>' : ""}`,
        );
        $("[data-clear]")?.addEventListener("click", () => {
          const previous = turns;
          turns = [];
          if (!save("voice", turns)) {
            turns = previous;
            return;
          }
          modal(
            "Transcript cleared",
            '<p>Your local transcript is empty. You can undo this change.</p><button class="solid" data-undo>Restore transcript</button>',
          );
          $("[data-undo]").onclick = () => {
            turns = previous;
            save("voice", turns);
            $("#viewer").close();
            render();
          };
          render();
        });
      };
      wireAccess(
        "voice",
        () => turns,
        (data) => {
          if (!valid(data))
            throw new Error("That workspace is not a compatible transcript.");
          if (current) {
            stopTimer();
            current = null;
            state = "ready";
          }
          turns = data;
          save("voice", turns);
          render();
        },
      );
    },
  );
}
window.addEventListener("pagehide", () => {
  stopTimer();
  if (current) commit("interrupted");
});
render();
