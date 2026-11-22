import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOriginalVoiceServer } from "./original-ui-server.mjs";
import { mkdirSync, existsSync } from "node:fs";
import { createDemoServer } from "./server.mjs";
import engine from "./engine-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.WORKSPACE_ORIGIN;
const state = process.env.WORKSPACE_STATE;
const port = Number(process.env.PORT);
if (
  !origin ||
  !state ||
  !path.isAbsolute(state) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw Error(
    "Set the exact HTTPS WORKSPACE_ORIGIN, absolute private WORKSPACE_STATE and a dedicated PORT.",
  );
const relative = path.relative(path.dirname(here), state);
if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
  throw Error("Hosted state must be outside the source checkout.");
process.umask(0o077);
mkdirSync(state, { recursive: true, mode: 0o700 });
const original = process.env.M8_WORKSPACE_UI === "original";
const publicRoot = original
  ? path.join(here, "..", "dist-hosted")
  : path.join(here, "public");
if (original && !existsSync(path.join(publicRoot, "index.html")))
  throw Error(
    "Build the original hosted UI before changing the running release.",
  );
const server = (original ? createOriginalVoiceServer : createDemoServer)({
  origin,
  hosted: true,
  registrationInvites: (process.env.WORKSPACE_INVITE_HASHES || "")
    .split(",")
    .filter(Boolean),
  root: publicRoot,
  storePath: path.join(state, "workspaces.json"),
  engine,
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    "Hosted English workspace listening on its private loopback port.",
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
