import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  SparkVoiceSession,
  sparkConfig,
  spokenChunk,
  pcmWave,
  rms16,
} from "../server/spark-voice.mjs";
const config = {
  llm: "http://localhost:8001",
  tts: "http://localhost:8002",
  asr: "http://localhost:8003",
  model: "test-local-model",
  token: "test-private-service-identity",
  voice: "Aria",
  sampleRate: 22050,
  asrKind: "nemo",
  asrModel: "test-speech-model",
};
test("private voice configuration rejects credential URLs and remote plaintext endpoints", () => {
  const env = {
    SPARK_LLM_URL: config.llm,
    SPARK_TTS_URL: config.tts,
    SPARK_ASR_URL: config.asr,
    SPARK_LLM_MODEL: config.model,
    SPARK_TTS_TOKEN: config.token,
    SPARK_ASR_MODEL: config.asrModel,
  };
  assert.ok(sparkConfig(env));
  assert.equal(
    sparkConfig({ ...env, SPARK_TTS_URL: "http://private.example" }),
    null,
  );
  assert.equal(
    sparkConfig({ ...env, SPARK_TTS_URL: "https://user:password@example.com" }),
    null,
  );
  assert.equal(
    sparkConfig({ ...env, SPARK_TTS_URL: "https://example.com?token=secret" }),
    null,
  );
});
test("spoken chunks preserve complete sentences and bounded first phrases", () => {
  assert.equal(
    spokenChunk("Start with the demo. Then inspect the source."),
    "Start with the demo. ",
  );
  assert.equal(spokenChunk("An unfinished phrase"), "");
  assert.equal(
    spokenChunk("An unfinished phrase", true),
    "An unfinished phrase",
  );
  assert.equal(spokenChunk("The amount is 19."), "");
  const pcm = Buffer.alloc(320);
  assert.equal(rms16(pcm), 0);
  const wave = pcmWave(pcm);
  assert.equal(wave.readUInt32LE(24), 16000);
  assert.equal(wave.readUInt32LE(40), 320);
});
test("real relay protocol fixes English, streams audio with its actual sample rate and never forwards credentials", async (t) => {
  const requests = [],
    events = [],
    metrics = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("chat/completions"))
      return new Response(
        "data: " +
          JSON.stringify({
            choices: [{ delta: { content: "Start with the demo. " } }],
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    if (url.includes("audio/speech"))
      return new Response(Buffer.alloc(2205 * 2), {
        headers: { "Content-Type": "audio/pcm" },
      });
    throw Error("Unsupported test route");
  };
  const session = new SparkVoiceSession(config, {
    fetcher,
    onMetrics: (value) => metrics.push(value),
  });
  t.after(() => session.close());
  session.on("message", (raw) => events.push(JSON.parse(raw)));
  await once(session, "open");
  await session.send(
    JSON.stringify({
      setup: { language: "es", tools: [{ name: "read_private_data" }] },
    }),
  );
  assert.equal(events[0].setupComplete.language, "en-US");
  assert.equal(events[0].setupComplete.capabilities.tools, false);
  await session.send(
    JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: "How should I review it?" }] }],
        turnComplete: true,
      },
    }),
  );
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.equal(body.tools, undefined);
  assert.ok(body.messages[0].content.includes("English"));
  assert.equal(
    requests[1].options.headers.Authorization,
    `Bearer ${config.token}`,
  );
  assert.equal(JSON.parse(requests[1].options.body).language, "en-US");
  const audio = events.flatMap(
    (e) => e.serverContent?.modelTurn?.parts || [],
  )[0].inlineData;
  assert.equal(audio.mimeType, "audio/pcm;rate=22050");
  assert.ok(events.some((e) => e.serverContent?.turnComplete));
  assert.ok(metrics[0].firstAudioMs >= 0);
  assert.ok(!JSON.stringify(events).includes(config.token));
});
test("unsupported tools and upstream errors remain safe and cannot execute actions", async (t) => {
  const session = new SparkVoiceSession(config, {
    fetcher: async () => {
      throw Error(config.token);
    },
  });
  t.after(() => session.close());
  await once(session, "open");
  const messages = [];
  session.on("message", (raw) => messages.push(raw));
  await session.send(JSON.stringify({ setup: {} }));
  await session.send(
    JSON.stringify({ toolResponse: { commands: ["delete"] } }),
  );
  await session.send(
    JSON.stringify({
      clientContent: { turns: [{ role: "user", parts: [{ text: "Hello" }] }] },
    }),
  );
  assert.ok(messages.some((m) => m.includes("could not finish")));
  assert.ok(!messages.join("").includes(config.token));
});

test("recorded PCM uses authenticated English NeMo transcription before generating speech", async (t) => {
  const requests = [],
    events = [];
  const session = new SparkVoiceSession(config, {
    fetcher: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("audio/transcriptions")) {
        assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
        assert.equal(options.body.get("model"), config.asrModel);
        assert.equal(options.body.get("language"), "en");
        assert.ok(options.body.get("file").size > 44);
        return Response.json({ text: "How can I review this project?" });
      }
      if (url.includes("chat/completions"))
        return new Response(
          "data: " +
            JSON.stringify({
              choices: [{ delta: { content: "Read the documentation. " } }],
            }) +
            "\n\ndata: [DONE]\n\n",
        );
      return new Response(Buffer.alloc(2000), {
        headers: {
          "Content-Type": "audio/pcm",
          "X-Audio-Sample-Rate": "22050",
        },
      });
    },
  });
  t.after(() => session.close());
  session.on("message", (raw) => events.push(JSON.parse(raw)));
  await once(session, "open");
  await session.send(JSON.stringify({ setup: {} }));
  const pcm = Buffer.alloc(16000);
  for (let n = 0; n < pcm.length; n += 2)
    pcm.writeInt16LE(n % 4 ? 5000 : -5000, n);
  await session.send(
    JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: pcm.toString("base64"),
        },
      },
    }),
  );
  await session.send(
    JSON.stringify({ realtimeInput: { audioStreamEnd: true } }),
  );
  assert.equal(
    events.find((e) => e.serverContent?.inputTranscription)?.serverContent
      .inputTranscription.text,
    "How can I review this project?",
  );
  assert.ok(events.some((e) => e.serverContent?.turnComplete));
  assert.equal(requests.length, 3);
});
