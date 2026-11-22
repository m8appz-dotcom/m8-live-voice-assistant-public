import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOriginalVoiceServer } from '../demo/original-ui-server.mjs';
import engine from '../demo/engine-adapter.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8897);
const server = createOriginalVoiceServer({ origin: 'http://localhost:' + port, hosted: false, root: path.join(root, 'dist-hosted'), storePath: path.join(root, '.preview-private/workspaces.json'), engine });
server.listen(port, '127.0.0.1', () => console.log('Original UI preview on localhost:' + port + '; real authentication required.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
