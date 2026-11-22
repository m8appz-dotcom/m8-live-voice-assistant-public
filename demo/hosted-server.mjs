import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
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
const server = createDemoServer({
  origin,
  hosted: true,
  registrationInvites: (process.env.WORKSPACE_INVITE_HASHES || "")
    .split(",")
    .filter(Boolean),
  root: path.join(here, "public"),
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
