import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.argv[2] || 'dist-hosted');
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (key.startsWith('EXPO_PUBLIC_')) delete environment[key];
Object.assign(environment, { EXPO_PUBLIC_M8_HOSTED_WORKSPACE: '1', EXPO_NO_DOTENV: '1' });
const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--output-dir', output], { cwd: root, env: environment, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
// Externalize only executable inline JS so the existing script-src self policy stays strict.
const file = path.join(output, 'index.html');
let html = readFileSync(file, 'utf8');
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attributes, code) => {
  if (/\bsrc\s*=/.test(attributes) || !code.trim() || /type\s*=\s*["']application\/json/i.test(attributes)) return all;
  if (/\btype\s*=/.test(attributes) && !/type\s*=\s*["'](?:module|text\/javascript)["']/i.test(attributes)) throw Error('Inspect this script type before exporting.');
  const name = 'bootstrap-' + createHash('sha256').update(code).digest('hex').slice(0,16) + '.js';
  mkdirSync(path.join(output, '_expo'), { recursive: true });
  writeFileSync(path.join(output, '_expo', name), code);
  return '<script' + attributes + ' src="/_expo/' + name + '"></script>';
});
writeFileSync(file, html);
// Retain the previous private-copy interface at /workspace/, without migrating its data.
cpSync(path.join(root, 'demo/public'), path.join(output, 'previous-workspace'), { recursive: true });
console.log('Exported original voice UI; previous workspace retained.');
