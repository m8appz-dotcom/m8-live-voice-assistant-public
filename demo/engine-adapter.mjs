import { WebSocket, WebSocketServer } from "ws";
import { timingSafeEqual } from "node:crypto";
import { SparkVoiceSession, sparkConfig } from "../server/spark-voice.mjs";

// This adapter uses an existing privately configured M8 bridge. No provider key is sent to the browser.
function config() {
  const transport = process.env.M8_DEMO_TRANSPORT || "bridge";
  if (transport === "spark") {
    const direct = sparkConfig();
    return direct ? { kind: "spark", direct } : null;
  }
  if (transport !== "bridge") return null;
  try {
    const url = new URL(process.env.M8_DEMO_BRIDGE_URL);
    const token = process.env.M8_DEMO_BRIDGE_TOKEN || "";
    const origin = new URL(process.env.M8_DEMO_BRIDGE_ORIGIN).origin;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/gemini" ||
      !["ws:", "wss:"].includes(url.protocol) ||
      (!loopback && url.protocol !== "wss:") ||
      token.length < 32
    )
      return null;
    return { kind: "bridge", url: url.toString(), token, origin };
  } catch {
    return null;
  }
}
export function liveMessage(value, started) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.setup && !started) return { setup: { language: "en-US" } };

  if (value.clientContent && started) {
    const parts = value.clientContent.turns;
    if (
      !Array.isArray(parts) ||
      parts.length !== 1 ||
      parts[0]?.role !== "user" ||
      !Array.isArray(parts[0].parts) ||
      parts[0].parts.length !== 1
    )
      return null;
    const text = parts[0].parts[0]?.text;
    return typeof text === "string" && text.trim() && text.length <= 4000
      ? {
          clientContent: {
            turns: [{ role: "user", parts: [{ text }] }],
            turnComplete: true,
          },
        }
      : null;
  }
  const audio = value.realtimeInput?.audio;
  if (
    started &&
    audio &&
    audio.mimeType === "audio/pcm;rate=16000" &&
    typeof audio.data === "string" &&
    audio.data.length <= 50000 &&
    /^[a-zA-Z0-9+/]*={0,2}$/.test(audio.data)
  )
    return {
      realtimeInput: { audio: { mimeType: audio.mimeType, data: audio.data } },
    };
  if (started && value.realtimeInput?.audioStreamEnd === true)
    return { realtimeInput: { audioStreamEnd: true } };
  return null;
}
function service(req) {
  const a = Buffer.from(process.env.DEMO_SERVICE_TOKEN || ""),
    b = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
  return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}
export default {
  allowMicrophone: true,
  name: "M8 Live",
  actions: [],
  status: async () => ({
    available: !!config(),
    provider: "private LLM and English speech",
    capabilities: config() ? ["Live text", "Microphone conversation"] : [],
    message: config()
      ? "Sign in with a passkey to start a live conversation."
      : "Live voice is unavailable in this copy. The authored text replay remains available.",
  }),
  attach(server, { origin, authenticated }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 60000 });
    const publicLimits =
      new URL(origin).protocol === "https:" ||
      process.env.M8_DEMO_PUBLIC === "1";
    const starts = new Map();
    let globalWindow = { count: 0, until: Date.now() + 3600000 };
    let active = 0;
    server.on("upgrade", (req, socket, head) => {
      const reject = (status) => {
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      };
      if (req.url !== "/engine/live") return reject("404 Not Found");
      if (
        req.headers.host !== new URL(origin).host ||
        req.headers.origin !== origin
      )
        return reject("403 Forbidden");
      const session = authenticated(req);
      const machine = service(req);
      if (!session && !machine) return reject("401 Unauthorized");
      const upstream = config();
      if (!upstream) return reject("503 Service Unavailable");
      if (active >= (publicLimits ? 1 : 2))
        return reject("429 Too Many Requests");
      if (publicLimits) {
        const now = Date.now();
        for (const [key, entry] of starts)
          if (entry.until < now) starts.delete(key);
        if (globalWindow.until < now)
          globalWindow = { count: 0, until: now + 3600000 };
        const who = machine ? "service" : session.user;
        const entry = starts.get(who) || { count: 0, until: now + 3600000 };
        if (
          entry.count >= 2 ||
          globalWindow.count >= 6 ||
          (!starts.has(who) && starts.size >= 1024)
        )
          return reject("429 Too Many Requests");
        entry.count++;
        starts.set(who, entry);
        globalWindow.count++;
      }
      wss.handleUpgrade(req, socket, head, (client) => {
        active++;
        let started = false,
          ready = false,
          ended = false,
          messages = 0,
          bytes = 0;
        const queue = [];
        const remote =
          upstream.kind === "spark"
            ? new SparkVoiceSession(upstream.direct)
            : new WebSocket(upstream.url, {
                headers: {
                  Authorization: `Bearer ${upstream.token}`,
                  Origin: upstream.origin,
                },
                maxPayload: 3000000,
                handshakeTimeout: 12000,
              });
        const stop = () => {
          if (ended) return;
          ended = true;
          active--;
          clearTimeout(deadline);
          remote.close();
          client.close();
        };
        const fail = () => {
          if (client.readyState === WebSocket.OPEN)
            client.send(
              JSON.stringify({
                error: {
                  message:
                    "The live voice service could not connect. Your example transcript is safe.",
                },
              }),
            );
          stop();
        };
        const deadline = setTimeout(stop, 180000);
        remote.on("open", () => {
          ready = true;
          for (const message of queue) remote.send(message);
          queue.length = 0;
        });
        client.on("message", (raw, binary) => {
          if (binary || ++messages > 2500 || (bytes += raw.length) > 6000000)
            return fail();
          try {
            const clean = liveMessage(JSON.parse(raw.toString()), started);
            if (!clean) return fail();
            if (clean.setup) started = true;
            const json = JSON.stringify(clean);
            if (ready) remote.send(json);
            else if (queue.length < 8) queue.push(json);
            else fail();
          } catch {
            fail();
          }
        });
        remote.on("message", (raw) => {
          if (client.bufferedAmount > 3000000) return fail();
          try {
            const data = JSON.parse(raw.toString());
            if (data.toolCall || data.toolCallCancellation) return fail();
            if (data.error) return fail();
            if (client.readyState === WebSocket.OPEN)
              client.send(JSON.stringify(data));
          } catch {
            fail();
          }
        });
        remote.on("error", fail);
        client.on("error", stop);
        client.on("close", stop);
        remote.on("close", stop);
      });
    });
    server.on("close", () => {
      for (const c of wss.clients) c.close();
      wss.close();
    });
  },
};
