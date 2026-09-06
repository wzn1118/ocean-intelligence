import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const command = process.argv[2] || 'list';
const client = new Client({ name: 'ocean-matlab-command-client', version: '0.1.0' });
const environment = getDefaultEnvironment();
for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'MATLAB_MCP_REPO', 'MATLAB_MCP_REF']) {
  if (process.env[name]) environment[name] = process.env[name];
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  env: environment,
  stderr: 'inherit',
});
try {
  await client.connect(transport);
  const result = command === 'list' ? await client.listTools() : await client.callTool({
    name: command,
    arguments: JSON.parse(await readFile('/dev/stdin', 'utf8')),
  }, undefined, { timeout: 180000 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
