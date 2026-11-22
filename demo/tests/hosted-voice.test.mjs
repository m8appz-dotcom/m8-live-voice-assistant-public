import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { WebSocket } from "ws";
import { createDemoServer } from "../server.mjs";
import engine from "../engine-adapter.mjs";

test("hosted direct voice preserves passkey gate, English PCM contract and public session quotas with controlled HTTP fixtures", async (t) => {
  const keys = [
    "M8_DEMO_TRANSPORT",
    "M8_DEMO_PUBLIC",
    "SPARK_LLM_URL",
    "SPARK_LLM_MODEL",
    "SPARK_TTS_URL",
    "SPARK_TTS_TOKEN",
    "SPARK_ASR_URL",
    "SPARK_ASR_MODEL",
    "DEMO_SERVICE_TOKEN",
  ];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  let modelCalls = 0,
    speechCalls = 0;
  const fixture = http.createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    if (req.url === "/v1/chat/completions") {
      modelCalls++;
      assert.equal(JSON.parse(body).model, "test-model");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        "data: " +
          JSON.stringify({
            choices: [
              { delta: { content: "Review the source and its tests. " } },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
      );
    } else if (req.url === "/v1/audio/speech") {
      speechCalls++;
      assert.equal(req.headers.authorization, "Bearer test-speech-identity");
      assert.equal(JSON.parse(body).voice, "Aria");
      res.writeHead(200, { "Content-Type": "audio/pcm" });
      res.end(Buffer.alloc(4410));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const endpoint = "http://127.0.0.1:" + fixture.address().port;
  Object.assign(process.env, {
    M8_DEMO_TRANSPORT: "spark",
    M8_DEMO_PUBLIC: "1",
    SPARK_LLM_URL: endpoint,
    SPARK_LLM_MODEL: "test-model",
    SPARK_TTS_URL: endpoint,
    SPARK_TTS_TOKEN: "test-speech-identity",
    SPARK_ASR_URL: endpoint,
    SPARK_ASR_MODEL: "test-asr",
    DEMO_SERVICE_TOKEN: "test-machine-service-identity-at-least-32-bytes",
  });
  const temporary = mkdtempSync(path.join(tmpdir(), "hosted-voice-test-"));
  const origin = "https://voice.example.test";
  const server = createDemoServer({
    origin,
    hosted: true,
    engine,
    storePath: path.join(temporary, "workspaces.json"),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const clients = [];
  t.after(async () => {
    for (const c of clients) c.terminate();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fixture.close(resolve));
    assert.ok(
      path
        .resolve(temporary)
        .startsWith(path.resolve(tmpdir()) + path.sep + "hosted-voice-test-"),
    );
    rmSync(temporary, { recursive: true });
    for (const k of keys)
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
  });
  const connect = (extra = {}) => {
    const c = new WebSocket(
      "ws://127.0.0.1:" + server.address().port + "/engine/live",
      {
        headers: {
          Host: "voice.example.test",
          Origin: origin,
          Authorization: "Bearer " + process.env.DEMO_SERVICE_TOKEN,
          ...extra,
        },
      },
    );
    clients.push(c);
    return c;
  };
  const rejected = (extra) =>
    new Promise((resolve, reject) => {
      const c = connect(extra);
      c.on("error", () => {});
      c.once("unexpected-response", (_r, res) => {
        res.resume();
        c.terminate();
        resolve(res.statusCode);
      });
      c.once("open", () => {
        c.terminate();
        reject(Error("Unexpected acceptance"));
      });
    });
  assert.equal(await rejected({ Authorization: "" }), 401);
  assert.equal(await rejected({ Origin: "https://other.example" }), 403);
  assert.equal(await rejected({ Host: "other.example" }), 403);
  assert.equal(modelCalls, 0);
  const c = connect();
  await new Promise((resolve, reject) => {
    c.once("open", resolve);
    c.once("error", reject);
  });
  assert.equal(await rejected({}), 429);
  const completed = new Promise((resolve, reject) => {
    let setup = false,
      audio = false,
      text = false;
    const timer = setTimeout(
      () => reject(Error("Fixture conversation timed out")),
      5000,
    );
    c.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.error) {
        clearTimeout(timer);
        reject(Error(data.error.message));
        return;
      }
      if (data.setupComplete) {
        setup = true;
        assert.equal(data.setupComplete.language, "en-US");
        assert.equal(data.setupComplete.sampleRate, 22050);
        c.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: "How should I review this project?" }],
                },
              ],
              turnComplete: true,
            },
          }),
        );
      }
      const content = data.serverContent;
      if (!content) return;
      if (content.outputTranscription?.text) text = true;
      for (const part of content.modelTurn?.parts || [])
        if (part.inlineData) {
          audio = true;
          assert.match(part.inlineData.mimeType, /22050/);
        }
      if (content.turnComplete) {
        clearTimeout(timer);
        resolve({ setup, audio, text });
      }
    });
  });
  c.send(JSON.stringify({ setup: { language: "en-US" } }));
  assert.deepEqual(await completed, { setup: true, audio: true, text: true });
  assert.equal(modelCalls, 1);
  assert.ok(speechCalls >= 1);
  await new Promise((resolve) => {
    c.once("close", resolve);
    c.close();
  });
  const second = connect();
  await new Promise((resolve, reject) => {
    second.once("open", resolve);
    second.once("error", reject);
  });
  await new Promise((resolve) => {
    second.once("close", resolve);
    second.close();
  });
  assert.equal(await rejected({}), 429);
});
