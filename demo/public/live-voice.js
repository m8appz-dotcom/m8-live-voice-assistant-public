import { $, modal, notify } from "./core.js";
import { downsample, pcm16ToB64, pcm16ToAudioBuffer } from "./native-pcm.js";

export async function mountLiveVoice(host) {
  if (!host) return;
  try {
    const response = await fetch("/engine/status"),
      status = await response.json();
    if (!host.isConnected) return;
    host.replaceChildren();
    const note = document.createElement("p");
    note.className = "quiet";
    note.textContent = status.message || "Live voice could not be checked.";
    host.append(note);
    if (!status.available) return;
    const button = document.createElement("button");
    button.textContent = "Start live conversation";
    host.append(button);
    button.onclick = async () => {
      const response = await fetch("/auth/status"),
        auth = await response.json();
      if (!auth.signedIn) {
        notify("Sign in with a passkey to start live voice.", true);
        $("[data-workspace]")?.click();
        return;
      }
      openLive();
    };
  } catch {
    if (host.isConnected)
      host.textContent =
        "Live voice could not be checked. The authored replay remains available.";
  }
}
function openLive() {
  modal(
    "Live conversation",
    '<p id="live-status" role="status">Connecting…</p><div id="live-transcript" aria-live="polite"></div><form id="live-prompt"><label for="live-question">Your question</label><input id="live-question" maxlength="4000" required><div class="action-row"><button id="live-send" disabled>Send question</button><button id="live-mic" type="button" disabled>Use microphone</button><button id="live-stop" type="button">End conversation</button></div></form><p class="quiet">English voice conversation. No account actions or external tools are enabled.</p>',
  );
  const dialog = $("#live-status").closest("dialog"),
    ctx = new AudioContext(),
    sources = new Set();
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/engine/live`,
  );
  let ended = false,
    ready = false,
    next = 0,
    stream = null,
    processor = null,
    input = null,
    silent = null,
    mic = false;
  const status = (text) => {
    if ($("#live-status")) $("#live-status").textContent = text;
  };
  const stopAudio = () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {}
    }
    sources.clear();
    next = 0;
  };
  const stopMic = () => {
    if (mic && socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    mic = false;
    processor?.disconnect();
    input?.disconnect();
    silent?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    processor = null;
    input = null;
    silent = null;
    if ($("#live-mic")) $("#live-mic").textContent = "Use microphone";
  };
  const stop = () => {
    if (ended) return;
    ended = true;
    stopMic();
    stopAudio();
    socket.close();
    ctx.close();
    status("Conversation ended.");
    $("#live-send")?.setAttribute("disabled", "");
    $("#live-mic")?.setAttribute("disabled", "");
  };
  dialog?.addEventListener("close", stop, { once: true });
  const observer = new MutationObserver(() => {
    if (!dialog?.isConnected) {
      stop();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const add = (speaker, text) => {
    if (!text) return;
    const row = document.createElement("p"),
      label = document.createElement("strong");
    label.textContent = speaker + ": ";
    row.append(label, document.createTextNode(text));
    $("#live-transcript")?.append(row);
  };
  socket.onopen = () => socket.send(JSON.stringify({ setup: {} }));
  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(
        typeof event.data === "string" ? event.data : await event.data.text(),
      );
      if (message.error) {
        stop();
        status(message.error.message);
        return;
      }
      if (message.setupComplete) {
        ready = true;
        status("Connected. Ask a question or enable your microphone.");
        $("#live-send").disabled = false;
        $("#live-mic").disabled = false;
      }
      const content = message.serverContent;
      if (!content) return;
      if (content.interrupted) stopAudio();
      add("You", content.inputTranscription?.text);
      add("M8", content.outputTranscription?.text);
      for (const part of content.modelTurn?.parts || []) {
        if (part.text) add("M8", part.text);
        if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
          await ctx.resume();
          const source = ctx.createBufferSource();
          source.buffer = pcm16ToAudioBuffer(ctx, part.inlineData.data, 24000);
          source.connect(ctx.destination);
          next = Math.max(ctx.currentTime, next);
          source.start(next);
          next += source.buffer.duration;
          sources.add(source);
          source.onended = () => sources.delete(source);
        }
      }
    } catch {
      status(
        "The voice reply could not be read. End the conversation and retry.",
      );
      stop();
    }
  };
  socket.onerror = () => {
    status("Live voice could not connect. Your local transcript is safe.");
  };
  socket.onclose = () => {
    stop();
  };
  $("#live-prompt").onsubmit = (e) => {
    e.preventDefault();
    const field = $("#live-question"),
      text = field.value.trim();
    if (!ready || !text) return;
    stopAudio();
    socket.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true,
        },
      }),
    );
    add("You", text);
    field.value = "";
  };
  $("#live-mic").onclick = async () => {
    if (mic) {
      stopMic();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (ended) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await ctx.resume();
      input = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(4096, 1, 1);
      silent = ctx.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (e) => {
        if (socket.readyState === WebSocket.OPEN && mic)
          socket.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data: pcm16ToB64(
                    downsample(
                      e.inputBuffer.getChannelData(0),
                      ctx.sampleRate,
                      16000,
                    ),
                  ),
                  mimeType: "audio/pcm;rate=16000",
                },
              },
            }),
          );
      };
      input.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);
      mic = true;
      $("#live-mic").textContent = "Stop microphone";
    } catch {
      stopMic();
      status(
        "Microphone access was not granted. You can still type a question.",
      );
    }
  };
  $("#live-stop").onclick = stop;
}
