import { EventEmitter } from "node:events";

function endpoint(value) {
  try {
    const u = new URL(value),
      local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    return !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === "https:" || (u.protocol === "http:" && local))
      ? u.toString().replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}
export function sparkConfig(env = process.env) {
  const llm = endpoint(env.SPARK_LLM_URL),
    tts = endpoint(env.SPARK_TTS_URL),
    asr = endpoint(env.SPARK_ASR_URL),
    model = env.SPARK_LLM_MODEL,
    token = env.SPARK_TTS_TOKEN,
    asrKind = env.SPARK_ASR_KIND || "nemo",
    asrModel = env.SPARK_ASR_MODEL;
  return llm &&
    tts &&
    asr &&
    model &&
    model.length < 160 &&
    token &&
    ["nemo", "whisper"].includes(asrKind) &&
    (asrKind === "whisper" || asrModel)
    ? {
        llm,
        tts,
        asr,
        model,
        token,
        asrKind,
        asrModel,
        voice: "Aria",
        sampleRate: 22050,
      }
    : null;
}
export function pcmWave(pcm, rate = 16000) {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function rms16(bytes) {
  let energy = 0;
  for (let n = 0; n + 1 < bytes.length; n += 2)
    energy += (bytes.readInt16LE(n) / 32768) ** 2;
  return Math.sqrt(energy / Math.max(1, bytes.length / 2));
}
export function spokenChunk(text, finished = false) {
  const sentence = text.match(/^([\s\S]*?[.!?]\s+)/);
  if (sentence) return sentence[1];
  const words = text.match(/\S+\s*/g) || [];
  if (words.length >= 12)
    return (text.match(/^\s*/)?.[0] || "") + words.slice(0, 10).join("");
  return finished ? text : "";
}
export class SparkVoiceSession extends EventEmitter {
  constructor(config, { fetcher = fetch, onMetrics = () => {} } = {}) {
    super();
    this.config = config;
    this.fetcher = fetcher;
    this.onMetrics = onMetrics;
    this.readyState = 0;
    this.started = false;
    this.history = [];
    this.controller = null;
    this.sequence = 0;
    this.capture = [];
    this.captureBytes = 0;
    this.voiced = false;
    this.silenceMs = 0;
    this.requests = 0;
    this.messages = 0;
    this.inputBytes = 0;
    this.asrBusy = false;
    this.deadline = setTimeout(() => this.close(), 180000);
    queueMicrotask(() => {
      if (this.readyState !== 3) {
        this.readyState = 1;
        this.emit("open");
      }
    });
  }
  emitMessage(value) {
    if (this.readyState === 1) this.emit("message", JSON.stringify(value));
  }
  safeError() {
    this.emitMessage({
      error: {
        message:
          "The private voice service could not finish. Retry your question.",
      },
    });
  }
  interrupt() {
    this.sequence++;
    this.controller?.abort();
    this.asrController?.abort();
    this.controller = null;
    this.emitMessage({ serverContent: { interrupted: true } });
  }
  async send(raw) {
    if (this.readyState !== 1) return;
    if (
      ++this.messages > 2500 ||
      (this.inputBytes += Buffer.byteLength(raw)) > 6500000
    )
      return this.close();
    try {
      if (Buffer.byteLength(raw) > 60000) throw Error("Message too large");
      const message = JSON.parse(String(raw));
      if (message.setup && !this.started) {
        this.started = true;
        this.emitMessage({
          setupComplete: {
            provider: "spark",
            language: "en-US",
            sampleRate: 22050,
            capabilities: {
              text: true,
              voice: true,
              vision: false,
              tools: false,
            },
          },
        });
        return;
      }
      if (!this.started) throw Error("Start a voice session first");
      const content = message.clientContent || message.client_content;
      if (content) {
        const turns = content.turns;
        if (
          !Array.isArray(turns) ||
          turns.length !== 1 ||
          turns[0].role !== "user" ||
          turns[0].parts?.length !== 1 ||
          typeof turns[0].parts[0].text !== "string"
        )
          throw Error("Only a text question is supported");
        await this.answer(turns[0].parts[0].text);
        return;
      }
      const input = message.realtimeInput || message.realtime_input;
      if (typeof input?.text === "string" && Object.keys(input).length === 1) {
        await this.answer(input.text);
        return;
      }
      if (input?.audioStreamEnd) {
        await this.transcribe();
        return;
      }
      const audio = input?.audio;
      if (
        audio &&
        audio.mimeType === "audio/pcm;rate=16000" &&
        typeof audio.data === "string" &&
        /^[a-zA-Z0-9+/]*={0,2}$/.test(audio.data)
      ) {
        const bytes = Buffer.from(audio.data, "base64");
        if (bytes.length % 2 || bytes.length > 32000)
          throw Error("Invalid audio");
        const speech = rms16(bytes) > 0.018,
          ms = bytes.length / 32;
        if (speech && !this.voiced) {
          this.interrupt();
          this.voiced = true;
          this.capture = [];
          this.captureBytes = 0;
        }
        if (this.voiced) {
          this.capture.push(bytes);
          this.captureBytes += bytes.length;
          this.silenceMs = speech ? 0 : this.silenceMs + ms;
          if (this.captureBytes >= 384000 || this.silenceMs >= 400)
            await this.transcribe();
        }
        return;
      }
      throw Error("Unsupported voice message");
    } catch (error) {
      if (error.name !== "AbortError") this.safeError();
    }
  }
  async transcribe() {
    if (!this.voiced || this.asrBusy) return;
    const pcm = Buffer.concat(this.capture);
    this.capture = [];
    this.captureBytes = 0;
    this.voiced = false;
    this.silenceMs = 0;
    if (pcm.length < 6400) return;
    this.asrBusy = true;
    const generation = this.sequence,
      start = performance.now(),
      controller = new AbortController();
    this.asrController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let target, options;
      if (this.config.asrKind === "whisper") {
        target = this.config.asr + "/v1/transcribe";
        options = {
          method: "POST",
          headers: { "Content-Type": "audio/wav", "X-Idioma": "en" },
          body: pcmWave(pcm),
          signal: controller.signal,
        };
      } else {
        const form = new FormData();
        form.append(
          "file",
          new Blob([pcmWave(pcm)], { type: "audio/wav" }),
          "utterance.wav",
        );
        form.append("model", this.config.asrModel);
        form.append("language", "en");
        target = this.config.asr + "/v1/audio/transcriptions";
        options = {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.token}` },
          body: form,
          signal: controller.signal,
        };
      }
      const response = await this.fetcher(target, options);
      if (!response.ok) throw Error("Transcription unavailable");
      const data = await response.json(),
        text = String(
          data.text ||
            data.transcript ||
            (Array.isArray(data.segmentos)
              ? data.segmentos.map((part) => part.texto || "").join(" ")
              : ""),
        ).trim();
      if (this.readyState !== 1 || generation !== this.sequence || !text)
        return;
      this.emitMessage({ serverContent: { inputTranscription: { text } } });
      this.onMetrics({
        transcriptionMs: Math.round(performance.now() - start),
      });
      await this.answer(text);
    } catch (error) {
      if (generation === this.sequence && this.readyState === 1)
        this.safeError();
    } finally {
      clearTimeout(timeout);
      this.asrBusy = false;
      if (this.asrController === controller) this.asrController = null;
    }
  }
  async answer(question) {
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 4000 ||
      ++this.requests > 12
    )
      throw Error("Question limit");
    this.interrupt();
    const generation = this.sequence,
      controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 45000),
      start = performance.now();
    let firstText = null,
      firstAudio = null,
      answer = "",
      pending = "",
      chain = Promise.resolve();
    const signal = controller.signal,
      alive = () =>
        generation === this.sequence &&
        this.readyState === 1 &&
        !signal.aborted;
    const speak = (text) => {
      chain = chain.then(async () => {
        if (!alive()) return;
        this.emitMessage({ serverContent: { outputTranscription: { text } } });
        const response = await this.fetcher(
          this.config.tts + "/v1/audio/speech",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.token}`,
            },
            body: JSON.stringify({
              input: text.trim(),
              voice: "Aria",
              language: "en-US",
            }),
            signal,
          },
        );
        if (
          !response.ok ||
          !response.headers.get("Content-Type")?.startsWith("audio/pcm")
        )
          throw Error("Speech unavailable");
        const rate = response.headers.get("X-Audio-Sample-Rate");
        if (rate && Number(rate) !== 22050)
          throw Error("Unexpected speech format");
        let remainder = Buffer.alloc(0);
        for await (const part of response.body) {
          if (!alive()) return;
          let bytes = Buffer.concat([remainder, Buffer.from(part)]);
          remainder = bytes.length % 2 ? bytes.subarray(-1) : Buffer.alloc(0);
          if (remainder.length) bytes = bytes.subarray(0, -1);
          if (!bytes.length) continue;
          firstAudio ??= performance.now() - start;
          this.emitMessage({
            serverContent: {
              modelTurn: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/pcm;rate=22050",
                      data: bytes.toString("base64"),
                    },
                  },
                ],
              },
            },
          });
        }
        if (remainder.length) throw Error("Incomplete audio sample");
      });
      chain.catch(() => {});
    };
    try {
      const response = await this.fetcher(
        this.config.llm + "/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              {
                role: "system",
                content:
                  "You are a clear, friendly English voice assistant. Answer directly in English in one or two sentences, at most 30 words total. Your first sentence must contain at most 7 words. Do not add a greeting, markdown, reasoning tags, or tools. You cannot access accounts or private data.",
              },
              ...this.history.slice(-6),
              { role: "user", content: question.trim() },
            ],
            max_tokens: 80,
            temperature: 0.3,
            stream: true,
            chat_template_kwargs: { enable_thinking: false },
          }),
          signal,
        },
      );
      if (!response.ok) throw Error("Text service unavailable");
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        if (!alive()) return;
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith("data:") || line === "data: [DONE]") continue;
          const event = JSON.parse(line.slice(5)),
            delta = event.choices?.[0]?.delta?.content;
          if (typeof delta !== "string" || !delta) continue;
          firstText ??= performance.now() - start;
          answer += delta;
          pending += delta;
          if (answer.length > 2000) throw Error("Reply limit");
          let text;
          while ((text = spokenChunk(pending))) {
            pending = pending.slice(text.length);
            speak(text);
          }
        }
      }
      if (pending.trim()) speak(pending);
      await chain;
      if (!alive()) return;
      if (!answer.trim() || firstAudio === null)
        throw Error("No spoken answer");
      this.history.push(
        { role: "user", content: question.trim() },
        { role: "assistant", content: answer },
      );
      this.history = this.history.slice(-6);
      this.emitMessage({ serverContent: { turnComplete: true } });
      this.onMetrics({
        firstTextMs: Math.round(firstText),
        firstAudioMs: Math.round(firstAudio),
        completeMs: Math.round(performance.now() - start),
      });
    } catch (error) {
      controller.abort();
      if (generation === this.sequence && this.readyState === 1)
        this.safeError();
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearTimeout(this.deadline);
    this.controller?.abort();
    this.asrController?.abort();
    this.sequence++;
    this.capture = [];
    this.history = [];
    this.emit("close", 1000, Buffer.from("Conversation ended"));
  }
}
