import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const requestId = z.string().uuid().describe('Request identifier returned by matlab_execute.');
const runId = z.number().int().positive().optional().describe('GitHub run identifier returned by matlab_status.');
const annotations = (readOnly, idempotent) => ({
  readOnlyHint: readOnly, destructiveHint: false, idempotentHint: idempotent, openWorldHint: true,
});

export function createMatlabMcpServer(executor) {
  const server = new McpServer({ name: 'ocean-matlab-execution', version: '0.1.0' }, {
    instructions: 'Execute real MathWorks MATLAB on the configured GitHub Actions runner. Submission is not execution. Poll matlab_status, then fetch matlab_artifacts and inspect execution.json, logs, results and images. MATLAB is not installed on this host. Code and artifacts are sent to the configured GitHub repository; never submit credentials or confidential data to a public repository. Native execution does not certify scientific or visual correctness.',
  });
  const invoke = (method) => async (arguments_) => {
    try {
      const result = await executor[method](arguments_);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'MATLAB execution tool failed';
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  };
  server.registerTool('matlab_execute', {
    title: 'Execute MATLAB Code',
    description: 'Submit actual MATLAB code to a licensed GitHub runner. This starts a billable remote job and sends the code/input to the configured repository, which may be public. No local MATLAB or Octave substitution. Save results and figures beneath getenv("MATLAB_OUTPUT_DIR"); optional input is input.json in that directory. Repository files are beneath getenv("MATLAB_PROJECT_ROOT"). Returns a request ID, not an execution success claim. Do not resubmit after an ambiguous transport failure without checking status.',
    inputSchema: z.object({
      code: z.string().min(1).max(32768).refine((value) => Buffer.byteLength(value, 'utf8') <= 32768, 'MATLAB code exceeds 32768 UTF-8 bytes').describe('MATLAB script, at most 32768 UTF-8 bytes.'),
      release: z.enum(['R2021a', 'R2024b', 'R2026a']).default('R2026a'),
      input_json: z.string().max(16384).refine((value) => Buffer.byteLength(value, 'utf8') <= 16384, 'Input exceeds 16384 UTF-8 bytes').describe('Optional JSON document, at most 16384 UTF-8 bytes.').optional(),
    }).strict(),
    annotations: annotations(false, false),
  }, invoke('execute'));
  server.registerTool('matlab_status', {
    title: 'Check MATLAB Execution',
    description: 'Read the workflow status for a request submitted through this server. Pending or workflow success alone is not verified MATLAB output; fetch and check bound artifacts after completion.',
    inputSchema: z.object({ request_id: requestId, run_id: runId }).strict(),
    annotations: annotations(true, true),
  }, invoke('status'));
  server.registerTool('matlab_artifacts', {
    title: 'Fetch MATLAB Results',
    description: 'Fetch completed execution artifacts into a server-owned local directory. Validate request, code, release, run, attempt and file hashes before returning paths. Downloads write local files; failed jobs retain diagnostics and are not reported as successful execution. Examine numeric results and rendered figures separately.',
    inputSchema: z.object({ request_id: requestId, run_id: runId }).strict(),
    annotations: annotations(false, true),
  }, invoke('artifacts'));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createMatlabExecutor } = await import('./github-executor.mjs');
  const executor = createMatlabExecutor({
    repo: process.env.MATLAB_MCP_REPO || 'wzn1118/ocean-intelligence',
    ref: process.env.MATLAB_MCP_REF || 'main',
  });
  const server = createMatlabMcpServer(executor);
  await server.connect(new StdioServerTransport());
}
