import http from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createCodexBrowserService } from './codex-browser-service.mjs';
import { createCodexHostCommandService } from './codex-host-command-service.mjs';
import { createCodexRuntimeCompatibility } from './codex-runtime-compatibility.mjs';
import { createIllustratedReportContract, illustratedReportInstructions } from './illustrated-report-contract.mjs';
import { OCEAN_REPORT_SPEC } from './ocean-report-spec.mjs';
import { inspectReportQuality } from './report-quality.mjs';
import { inspectThreadRecovery } from './thread-recovery.mjs';
import { isThreadNotLoaded } from './thread-state.mjs';
import { createMcpTenantToken } from './mcp-tenant-token.mjs';
import { extractArtifactReferences, normalizeArtifactReference, timestampMilliseconds } from './artifact-references.mjs';
import {
  RESTRICTED_CONTENT_MESSAGE,
  assertPermittedContent,
  containsRestrictedContent,
  redactLivePayload,
  sanitizeOutput,
  sanitizeRestrictedPayload,
} from './codex-content-policy.mjs';

const runtimeDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectRoot = path.resolve(runtimeDir, '..');
const host = process.env.OCEAN_CODEX_HOST || '127.0.0.1';
const port = Number(process.env.OCEAN_CODEX_PORT || 8011);
const workspaceRoot = path.resolve(process.env.OCEAN_CODEX_WORKSPACE || projectRoot);
const tenantSecret = String(process.env.OCEAN_CODEX_TENANT_SECRET || '').trim();
const threadOwnersPath = path.join(workspaceRoot, '.runtime', 'codex-thread-owners.json');
const activeTenantOwners = new Map();
let threadOwners = null;
let threadOwnersLoad = null;
let threadOwnersWrite = Promise.resolve();
const executablePath = resolveCodexExecutable();
const rendererRuntimeRoot = resolveRendererRuntimeRoot();
const compatibility = rendererRuntimeRoot ? createCodexRuntimeCompatibility({ runtimeRoot: rendererRuntimeRoot }) : null;
const rendererRuntime = compatibility ? await compatibility.inspect() : null;

const mcpToken = String(process.env.OCEAN_CODEX_MCP_TOKEN || '').trim();
const contextMcps = mcpToken ? [{
  name: 'ocean-intelligence',
  url: process.env.OCEAN_CODEX_MCP_URL || 'http://127.0.0.1:8000/api/codex/mcp',
  token: mcpToken,
  bearerTokenEnvVar: 'OCEAN_CODEX_MCP_TOKEN',
}] : [];
const modelProvider = buildModelProvider();
const browser = createCodexBrowserService({
  executablePath,
  workspaceRoot,
  contextMcps,
  modelProvider,
  dynamicToolHandler: handleTenantMcpTool,
});
const HARNESS_REQUEST_METHODS = new Set([
  'account/read',
  'config/read',
  'mcpServer/resource/read',
  'mcpServer/tool/call',
  'mcpServerStatus/list',
  'model/list',
  'plugin/list',
  'plugin/read',
  'remoteControl/status/read',
  'skills/list',
]);
const hostCommands = createCodexHostCommandService({
  config: {
    projectRoot,
    workspaceRoot,
    codexWorktreeRoot: path.join(projectRoot, '.runtime', 'codex-worktrees'),
  },
  codexBrowserService: browser,
});

let startupError = null;
try {
  await browser.start();
} catch (error) {
  startupError = serializeError(error);
}

const server = http.createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
    const tenant = authenticateTenant(request, url);
    await ensureTenant(tenant);
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/status') {
      return json(response, startupError ? 503 : 200, runtimeStatus());
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-runtime/probe') {
      return json(response, 200, await probeRuntime(tenant));
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/harness') {
      return json(response, 200, await harnessSnapshot(tenant));
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-runtime/harness/request') {
      const body = await readJson(request);
      const method = cleanText(body.method, '', 160);
      if (!HARNESS_REQUEST_METHODS.has(method)) {
        return errorJson(response, 403, 'CODEX_HARNESS_METHOD_FORBIDDEN', `Harness method is not exposed: ${method}`);
      }
      const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      assertPermittedContent(JSON.stringify(params));
      const timeoutMs = boundedInteger(body.timeoutMs, 90_000, 1_000, 300_000);
      const result = await browser.request(method, params, { timeoutMs });
      return json(response, 200, sanitizeOutput({ method, result }));
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/events') {
      return await listEventResponse(response, url, tenant);
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/event-stream') {
      return await streamEvents(request, response, url, tenant);
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/threads') {
      const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 100);
      const params = {
        limit,
        cwd: tenant.cwd,
        archived: url.searchParams.get('archived') === 'true',
        sortKey: 'updated_at',
        sortDirection: 'desc',
      };
      const cursor = String(url.searchParams.get('cursor') || '').trim();
      const searchTerm = String(url.searchParams.get('search') || '').trim();
      if (searchTerm) assertPermittedContent(searchTerm);
      if (cursor) params.cursor = cursor;
      if (searchTerm) params.searchTerm = searchTerm;
      const result = await browser.request('thread/list', params, { timeoutMs: 60_000 });
      await claimListedThreads(tenant, result);
      return json(response, 200, sanitizeOutput(await filterTenantThreads(result, tenant)));
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-runtime/threads') {
      const body = await readJson(request);
      const regionId = cleanText(body.regionId, 'global_ocean', 80);
      const instructions = oceanDeveloperInstructions(regionId, tenant);
      const result = await browser.request('thread/start', {
        cwd: tenant.cwd,
        runtimeWorkspaceRoots: [tenant.cwd],
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        developerInstructions: instructions,
        personality: 'pragmatic',
        ephemeral: false,
      }, { timeoutMs: 90_000 });
      const thread = result?.thread || result;
      if (thread?.id) await claimThread(tenant, thread.id);
      return json(response, 201, result);
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/reports/status') {
      const threadId = safeThreadId(url.searchParams.get('threadId'));
      if (!await tenantOwnsThread(tenant, threadId)) {
        return errorJson(response, 404, 'CODEX_THREAD_NOT_FOUND', 'Codex thread was not found.');
      }
      const reportId = cleanText(url.searchParams.get('reportId'), '', 80);
      const report = createIllustratedReportContract(tenant.generatedRoot, reportId);
      if (!reportId || report.id !== reportId) {
        return errorJson(response, 400, 'CODEX_REPORT_ID_INVALID', 'A valid report id is required.');
      }
      const coreArtifacts = report.absolutePaths.flatMap((absolutePath) => {
        try {
          const artifact = tenantFileMetadata(tenant, absolutePath);
          return artifact.size > 0 ? [artifact] : [];
        } catch {
          return [];
        }
      });
      const visualFilePrefix = path.basename(report.absoluteVisualPrefix);
      const visualArtifacts = existsSync(tenant.generatedRoot)
        ? readdirSync(tenant.generatedRoot, { withFileTypes: true }).flatMap((entry) => {
            if (!entry.isFile() || !entry.name.startsWith(visualFilePrefix) || !/\.(?:svg|png|jpe?g|webp|gif)$/iu.test(entry.name)) return [];
            try {
              const artifact = tenantFileMetadata(tenant, path.join(tenant.generatedRoot, entry.name));
              return artifact.size > 0 ? [artifact] : [];
            } catch {
              return [];
            }
          })
        : [];
      const artifacts = [...coreArtifacts, ...visualArtifacts].sort((left, right) => left.path.localeCompare(right.path));
      const available = new Set(coreArtifacts.map((artifact) => artifact.path));
      const missingPaths = report.relativePaths.filter((candidate) => !available.has(candidate));
      const visualDeficit = Math.max(0, report.minimumVisuals - visualArtifacts.length);
      for (let index = 0; index < visualDeficit; index += 1) {
        missingPaths.push(`${report.visualPrefix}${String(visualArtifacts.length + index + 1).padStart(2, '0')}.(svg|png|jpg|webp)`);
      }
      const quality = inspectReportQuality(report.absolutePaths[0], report.absolutePaths[1], report.minimumHeadings, report.minimumMarkdownBytes, report.minimumHtmlBytes, report.minimumHtmlFigures, report.minimumAnalyticalClaims, report.minimumComparisons, report.minimumEvidenceMarkers, report.requiredZoneCount, report.minimumChartTypes);
      if (!quality.markdownBytesOk) missingPaths.push(`Markdown 至少 ${report.minimumMarkdownBytes} bytes（当前 ${quality.markdownBytes}）`);
      if (!quality.htmlBytesOk) missingPaths.push(`HTML 至少 ${report.minimumHtmlBytes} bytes（当前 ${quality.htmlBytes}）`);
      if (!quality.headingCountOk) missingPaths.push(`至少 ${report.minimumHeadings} 个正文标题（当前 ${quality.headingCount}）`);
      if (!quality.figureCountOk) missingPaths.push(`HTML 至少 ${report.minimumHtmlFigures} 个图文视觉位（当前 ${quality.figureCount}）`);
      if (!quality.chartMetadataOk) missingPaths.push('每个专业图位必须声明 data-chart-type/data-chart-family/data-source，并包含 figcaption');
      if (!quality.chartDiversityOk) missingPaths.push(`至少 ${report.minimumChartTypes} 种不同专业图表类型（当前 ${quality.uniqueChartTypes}）`);
      if (!quality.scientificChartFamiliesOk) missingPaths.push('必须满足空间≥3、时间≥3、剖面/结构≥2、方向/矢量≥2、不确定性≥2、物理诊断≥3个图位');
      if (!quality.chartSemanticsOk) missingPaths.push('图表必须标注坐标/时间、变量单位、样本量/QC/缺测或不确定性语义');
      if (!quality.figureInterpretationOk) missingPaths.push(`每个图表必须关联完整解释块，包含观测、物理机制、现实意义、不确定性和验证路径（当前 ${quality.completeFigureInterpretationCount}/${quality.figureCount}）`);
      if (!quality.waveEnergySemanticsOk) missingPaths.push('风浪章节必须依据 E=ρgHs²/16 区分波高变化与波能变化，并量化能量比例');
      if (!quality.crossVariableConsistencyOk) missingPaths.push('必须完成风浪跨变量一致性诊断：共同时间窗、方向/有效风区、涌浪来源、响应时滞及替代机制判别');
      if (!quality.operationalImpactOk) missingPaths.push('现实意义必须采用暴露—脆弱性—后果框架，并列触发指标、空间边界、证据等级和解除条件');
      if (!quality.anomalyRankingOk) missingPaths.push('异常分析必须包含全区前10、正负异常、评分分量、持续性和空间支持的综合排名');
      if (!quality.zoneAnomalyCoverageOk) missingPaths.push('异常分析必须覆盖九区各区前3名或明确逐区数据缺口');
      if (!quality.collocatedPointInventoryOk) missingPaths.push('必须列出异常附近平台及距离、时间差、深度差、QC和L1-L5联动等级');
      if (!quality.collocationMethodOk) missingPaths.push('必须说明核心/局地/背景半径、共同时间轴、时间容差、深度容差和网格分辨率约束');
      if (!quality.independentValidationOk) missingPaths.push('必须区分L1独立验证资格与同源支持，并统计每个候选的L1数量');
      if (!quality.crossVariableMatrixOk) missingPaths.push('必须提供跨变量联动矩阵，包含共同样本量、相关/效应方向、滞后、方向夹角和来源关系');
      if (!quality.lagAnalysisOk) missingPaths.push('必须调用lag_correlation并报告最佳/最大滞后、重叠样本、自相关和多重检验限制');
      if (!quality.falsificationPathOk) missingPaths.push('异常机制必须给出支持、削弱或否定结论的补测与可证伪路径');
      if (!quality.editorialStyleOk) missingPaths.push(`语言编辑未通过：清除防御性句式、AI套话和非学术单字动词（当前 ${quality.editorialStyleViolationCount} 处）`);
      if (!quality.analyticalClaimsOk) missingPaths.push(`至少 ${report.minimumAnalyticalClaims} 条明确分析判断（当前 ${quality.analyticalClaims}）`);
      if (!quality.comparisonsOk) missingPaths.push(`至少 ${report.minimumComparisons} 条量化比较（当前 ${quality.comparisons}）`);
      if (!quality.evidenceMarkersOk) missingPaths.push(`至少 ${report.minimumEvidenceMarkers} 个证据标记（当前 ${quality.evidenceMarkers}）`);
      if (!quality.centerPointOk) missingPaths.push('必须标出分析中心点及其经纬度');
      if (!quality.geographyResolutionOk) missingPaths.push('必须说明文本/点位海域识别结果、selected_by、几何状态和范围来源');
      if (!quality.zoneCoverageOk) missingPaths.push(`必须完整覆盖九区（当前识别 ${quality.zoneCoverage}/${report.requiredZoneCount}）`);
      if (!quality.pointInventoryOk) missingPaths.push('必须包含九区点位数量、原始/有效记录、独立平台、密度、QC和时效统计');
      if (!quality.pointZoneCoverageOk) missingPaths.push(`Argo、浮标、岸基观测章节必须逐区交代点位数量或缺口（当前 ${quality.pointZoneCoverage}/${report.requiredZoneCount}）`);
      if (!quality.pointAuditOk) missingPaths.push('必须审计未归区、区外、坐标异常、重复或QC失败记录');
      if (!quality.windTimeSemanticsOk) missingPaths.push('风场章节必须区分请求/有效窗口、数据时次、24小时跨度、时间戳数量和数据延迟');
      if (!quality.windVectorSemanticsOk) missingPaths.push('风场章节必须区分风矢量数与u/v分量值数，并报告风速、风向和方向一致性');
      if (!quality.windSpatialMethodOk) missingPaths.push('风场章节必须报告九区、海陆/零值掩膜、有效覆盖率和面积加权口径');
      if (!quality.windComparisonOk) missingPaths.push('风场章节必须与前一等长窗口或基线比较，无法比较时说明原因');
      if (!quality.windPointValidationOk) missingPaths.push('风场章节必须说明九区同期原位风点位数量和独立验证能力');
      const variableMessages = {
        seaSurfaceTemperature: '海表温度章节必须说明温度定义/单位、有效覆盖与掩膜、权重、九区统计、前窗/基线和同期原位验证',
        salinityStructure: '盐度与温盐结构章节必须说明盐度体系、剖面/层数/QC、跃层判据、T-S方法、九区覆盖和验证缺口',
        surfaceCurrent: '表层流章节必须区分u/v、矢量/分量计数、流速/流向/R、代表深度、掩膜权重、九区、前窗和原位验证',
        waves: '波浪章节必须拆分总浪/涌浪/风浪，说明Hs/周期/方向、分析与预报时间、非线性合成、九区、掩膜和浮标验证',
        ecology: '叶绿素与生态章节必须说明单位与偏态统计、云/近岸/QC掩膜、零负值、九区、基线、现场验证和生态解释边界',
        coupling: '风浪流耦合章节必须报告共同覆盖/时间戳/样本、方向夹角、相关或敏感性及非因果替代解释',
        anomalyCandidates: '异常候选章节必须报告阈值/基线、持续性、空间连续性、支持样本、独立验证和候选状态',
        dataQuality: '数据质量章节必须逐源报告有效/抓取时间、延迟、分辨率、覆盖/QC、缓存/失败/抽样及结论影响',
      };
      for (const [key, message] of Object.entries(variableMessages)) {
        if (!quality.variableSectionChecks?.[key]) missingPaths.push(message);
      }
      if (!quality.physicalRotationOk) missingPaths.push('物理机制诊断必须调用 ocean_physics_diagnostics，并报告中心点科氏参数、beta 和惯性周期');
      if (!quality.physicalScaleAnalysisOk) missingPaths.push('物理机制诊断必须给出 U-L-H-T 尺度、Rossby 数，以及可计算的 Froude/Burger/变形半径或缺失输入');
      if (!quality.physicalBalanceOk) missingPaths.push('物理机制诊断必须按动量方程排序主导项，并量化讨论至少两个替代机制');
      if (!quality.physicalProvenanceOk) missingPaths.push('每个物理派生量必须列输入证据、方程、单位、假设、适用条件和失效条件');
      if (!quality.physicalZoneRegimeOk) missingPaths.push('必须完成九区物理机制分型，说明各区主导过程差异');
      if (!quality.physicalUncertaintyOk) missingPaths.push('物理机制诊断必须包含敏感性分析、不确定度/误差传播和可证伪条件');
      if (!quality.textbookReferenceOk) missingPaths.push('物理机制诊断必须至少引用3条 Stewart 2008 章/节/教材页码，并区分教材理论依据与当前数据证据');
      return json(response, 200, {
        complete: missingPaths.length === 0,
        artifacts,
        missingPaths,
        visualCount: visualArtifacts.length,
        minimumVisuals: report.minimumVisuals,
        minimumChartTypes: report.minimumChartTypes,
        quality,
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/artifacts') {
      const threadId = cleanText(url.searchParams.get('threadId'), '', 160);
      if (!threadId) return errorJson(response, 400, 'CODEX_THREAD_REQUIRED', 'threadId is required.');
      const thread = await requireTenantThread(tenant, threadId, true);
      return json(response, 200, { artifacts: collectThreadArtifacts(thread, tenant).filter((artifact) => !containsRestrictedContent(artifact.name)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/uploads') {
      const threadId = safeThreadId(url.searchParams.get('threadId'));
      await requireTenantThread(tenant, threadId);
      return json(response, 200, { uploads: collectThreadUploads(tenant, threadId).filter((upload) => !containsRestrictedContent(upload.name)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-runtime/uploads') {
      const threadId = safeThreadId(url.searchParams.get('threadId'));
      await requireTenantThread(tenant, threadId);
      const fileName = safeUploadName(url.searchParams.get('name'));
      const content = await readBuffer(request, 25 * 1024 * 1024);
      if (!content.length) return errorJson(response, 400, 'CODEX_UPLOAD_EMPTY', 'Uploaded file is empty.');
      assertPermittedContent(fileName);
      const uploadType = mimeType(fileName);
      assertPolicyScannableMime(uploadType, 'CODEX_UNSCANNABLE_UPLOAD_BLOCKED');
      assertPermittedContent(content.toString('utf8'));
      const upload = await saveThreadUpload(tenant, threadId, fileName, content);
      return json(response, 201, { upload });
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/artifacts/content') {
      const artifact = resolveTenantFile(tenant, url.searchParams.get('path'));
      const info = await stat(artifact.absolutePath);
      if (!info.isFile()) return errorJson(response, 404, 'CODEX_ARTIFACT_NOT_FOUND', 'Artifact file was not found.');
      const previewLimit = 1024 * 1024;
      const content = await readFile(artifact.absolutePath);
      const artifactType = mimeType(artifact.absolutePath);
      assertPolicyScannableMime(artifactType, 'CODEX_UNSCANNABLE_ARTIFACT_BLOCKED');
      if (containsRestrictedContent(content.toString('utf8'))) {
        return errorJson(response, 451, 'CODEX_CONTENT_RESTRICTED', RESTRICTED_CONTENT_MESSAGE);
      }
      return json(response, 200, {
        path: artifact.relativePath,
        content: content.subarray(0, previewLimit).toString('utf8'),
        truncated: content.length > previewLimit,
        mimeType: mimeType(artifact.absolutePath),
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-runtime/artifacts/download') {
      const artifact = resolveTenantFile(tenant, url.searchParams.get('path'));
      const info = await stat(artifact.absolutePath);
      if (!info.isFile()) return errorJson(response, 404, 'CODEX_ARTIFACT_NOT_FOUND', 'Artifact file was not found.');
      if (info.size > 50 * 1024 * 1024) return errorJson(response, 413, 'CODEX_ARTIFACT_TOO_LARGE', 'Artifact exceeds the 50 MB download limit.');
      const content = await readFile(artifact.absolutePath);
      const artifactType = mimeType(artifact.absolutePath);
      assertPolicyScannableMime(artifactType, 'CODEX_UNSCANNABLE_ARTIFACT_BLOCKED');
      if (containsRestrictedContent(content.toString('utf8'))) {
        return errorJson(response, 451, 'CODEX_CONTENT_RESTRICTED', RESTRICTED_CONTENT_MESSAGE);
      }
      const disposition = url.searchParams.get('inline') === 'true' ? 'inline' : 'attachment';
      response.writeHead(200, {
        'Content-Type': mimeType(artifact.absolutePath),
        'Content-Length': content.length,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(path.basename(artifact.absolutePath))}`,
        'Cache-Control': 'private, no-store',
      });
      response.end(content);
      return;
    }

    const readMatch = url.pathname.match(/^\/api\/codex-runtime\/threads\/([^/]+)$/u);
    if (request.method === 'GET' && readMatch) {
      const threadId = decodeURIComponent(readMatch[1]);
      let thread = await requireTenantThread(tenant, threadId, true);
      if (isThreadNotLoaded(thread)) {
        await resumeTenantThread(tenant, threadId);
        thread = await requireTenantThread(tenant, threadId, true);
      }
      return json(response, 200, sanitizeOutput({ thread }));
    }
    const resumeMatch = url.pathname.match(/^\/api\/codex-runtime\/threads\/([^/]+)\/resume$/u);
    if (request.method === 'POST' && resumeMatch) {
      const threadId = decodeURIComponent(resumeMatch[1]);
      await requireTenantThread(tenant, threadId);
      await resumeTenantThread(tenant, threadId);
      const thread = await requireTenantThread(tenant, threadId, true);
      return json(response, 200, sanitizeOutput({ thread, recovery: inspectThreadRecovery(thread) }));
    }
    const turnMatch = url.pathname.match(/^\/api\/codex-runtime\/threads\/([^/]+)\/turns$/u);
    if (request.method === 'POST' && turnMatch) {
      const body = await readJson(request);
      const text = cleanText(body.text, '', 60_000);
      if (!text) return errorJson(response, 400, 'CODEX_INPUT_REQUIRED', 'Turn text is required.');
      assertPermittedContent(text);
      const threadId = decodeURIComponent(turnMatch[1]);
      const existingThread = await requireTenantThread(tenant, threadId);
      if (isThreadNotLoaded(existingThread)) await resumeTenantThread(tenant, threadId);
      const outputMode = cleanText(body.outputMode, 'conversation', 40);
      if (!['conversation', 'illustrated_report'].includes(outputMode)) {
        return errorJson(response, 400, 'CODEX_OUTPUT_MODE_INVALID', 'Unsupported Codex output mode.');
      }
      const report = outputMode === 'illustrated_report'
        ? createIllustratedReportContract(tenant.generatedRoot, cleanText(body.reportId, '', 80))
        : null;
      const turnText = report ? `${text}${illustratedReportInstructions(report)}` : text;
      const params = {
        threadId,
        input: [{ type: 'text', text: turnText }, ...localImageInputs(tenant, body.attachments)],
        cwd: tenant.cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      };
      const effort = cleanText(body.effort, '', 20);
      const model = cleanText(body.model, '', 120);
      if (effort) params.effort = effort;
      if (model) params.model = model;
      if (body.additionalContext && typeof body.additionalContext === 'object') params.additionalContext = body.additionalContext;
      const result = await browser.request('turn/start', params, { timeoutMs: 90_000 });
      return json(response, 202, report ? {
        ...result,
        report: {
          id: report.id,
          requiredPaths: report.relativePaths,
          minimumVisuals: report.minimumVisuals,
          minimumChartTypes: report.minimumChartTypes,
          minimumHeadings: report.minimumHeadings,
          minimumMarkdownBytes: report.minimumMarkdownBytes,
          minimumHtmlBytes: report.minimumHtmlBytes,
          minimumHtmlFigures: report.minimumHtmlFigures,
          minimumAnalyticalClaims: report.minimumAnalyticalClaims,
          minimumComparisons: report.minimumComparisons,
          minimumEvidenceMarkers: report.minimumEvidenceMarkers,
          requiredZoneCount: report.requiredZoneCount,
          requiresPointInventory: report.requiresPointInventory,
          requiresWindAnalysis: report.requiresWindAnalysis,
          visualPrefix: report.visualPrefix,
        },
      } : result);
    }
    const interruptMatch = url.pathname.match(/^\/api\/codex-runtime\/threads\/([^/]+)\/interrupt$/u);
    if (request.method === 'POST' && interruptMatch) {
      const body = await readJson(request);
      const threadId = decodeURIComponent(interruptMatch[1]);
      await requireTenantThread(tenant, threadId);
      const turnId = cleanText(body.turnId, '', 160);
      if (!turnId) return errorJson(response, 400, 'CODEX_TURN_REQUIRED', 'turnId is required.');
      return json(response, 200, await browser.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 60_000 }));
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-runtime/respond') {
      const body = await readJson(request);
      if (body.id == null || !body.result || typeof body.result !== 'object') {
        return errorJson(response, 400, 'CODEX_RESPONSE_INVALID', 'A protocol request id and result object are required.');
      }
      browser.transport.sendRaw({ id: body.id, result: body.result });
      return json(response, 202, { accepted: true });
    }

    // Compatibility routes retained for the optional official renderer diagnostic view.
    if (request.method === 'GET' && url.pathname === '/api/codex-browser/status') {
      return json(response, startupError ? 503 : 200, runtimeStatus());
    }
    if (request.method === 'GET' && url.pathname === '/api/codex-browser/events') {
      return listEventResponse(response, url);
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-browser/messages') {
      const body = await readJson(request);
      const result = await hostCommands.sendLegacy({
        sessionId: String(body.sessionId || ''),
        commandId: body.commandId,
        message: body.message && typeof body.message === 'object' ? body.message : body,
      });
      return json(response, 200, result);
    }
    if (request.method === 'POST' && url.pathname === '/api/codex-browser/worker-messages') {
      const body = await readJson(request);
      return json(response, 200, await hostCommands.sendWorkerLegacy({
        sessionId: String(body.sessionId || ''),
        commandId: body.commandId,
        workerId: body.workerId,
        message: body.message,
      }));
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/codex' || url.pathname.startsWith('/codex/'))) {
      if (!rendererRuntime?.ready) {
        return errorJson(response, 404, 'CODEX_RENDERER_UNAVAILABLE', 'The optional official renderer is not installed; use the integrated Ocean Agent UI.');
      }
      if (url.pathname === '/codex') {
        response.writeHead(302, { Location: '/codex/' });
        response.end();
        return;
      }
      if (await serveCodexAsset(request, response, url.pathname)) return;
      return errorJson(response, 404, 'CODEX_ASSET_NOT_FOUND', 'Codex runtime asset was not found.');
    }
    return errorJson(response, 404, 'NOT_FOUND', 'Codex runtime route was not found.');
  } catch (error) {
    return errorJson(response, Number(error?.status || 500), String(error?.code || 'CODEX_RUNTIME_ERROR'), String(error?.message || error));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`${JSON.stringify({
    ready: !startupError,
    url: `http://${host}:${port}`,
    executablePath,
    appServer: browser.status().appServerVersion,
    workspaceRoot,
    renderer: rendererRuntime?.ready ? 'available' : 'optional-unavailable',
    mcp: contextMcps.map((entry) => entry.name),
    model: modelProvider?.model || 'codex-config',
  })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await browser.close().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3_000).unref();
  });
}

function resolveCodexExecutable() {
  const explicit = String(process.env.OCEAN_CODEX_BIN || '').trim();
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  if (localAppData) collectExecutables(path.join(localAppData, 'OpenAI', 'Codex', 'bin'), candidates, 2);
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) candidates.push(path.join(entry, process.platform === 'win32' ? 'codex.exe' : 'codex'));
  const found = candidates
    .filter((candidate, index, all) => all.indexOf(candidate) === index && existsSync(candidate))
    .map((candidate) => ({ candidate, modifiedAt: safeMtime(candidate) }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (found[0]) return found[0].candidate;
  throw new Error('Current Codex executable was not found. Set OCEAN_CODEX_BIN to codex.exe.');
}

function collectExecutables(root, output, depth) {
  if (!existsSync(root) || depth < 0) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === (process.platform === 'win32' ? 'codex.exe' : 'codex')) output.push(target);
    else if (entry.isDirectory()) collectExecutables(target, output, depth - 1);
  }
}

function safeMtime(target) {
  try { return statSync(target).mtimeMs; } catch { return 0; }
}

function resolveRendererRuntimeRoot() {
  const candidates = [
    process.env.OCEAN_CODEX_RUNTIME_ROOT,
    path.join(projectRoot, 'vendor', 'codex-desktop-runtime'),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  return candidates.find((candidate) => (
    existsSync(path.join(candidate, 'app', 'resources', 'app-unpacked', 'webview', 'index.html'))
    && existsSync(path.join(candidate, 'app', 'resources', 'codex.exe'))
  )) || null;
}

function buildModelProvider() {
  const apiKey = environmentValue('OCEAN_AGENT_API_KEY');
  const rawUrl = environmentValue('OCEAN_AGENT_API_URL');
  const model = environmentValue('OCEAN_AGENT_API_MODEL') || 'gpt-5.5';
  if (!apiKey || !rawUrl || !model) return null;
  const baseUrl = rawUrl.replace(/\/(?:v1\/)?responses\/?$/iu, '').replace(/\/+$/u, '');
  return {
    id: 'ocean_openqi',
    name: 'OpenQI',
    baseUrl,
    model,
    apiKey,
    apiKeyEnvVar: 'OCEAN_CODEX_MODEL_KEY',
  };
}

function environmentValue(name) {
  return String(process.env[name] || '').trim();
}

function authenticateTenant(request, url) {
  if (!tenantSecret) throw Object.assign(new Error('Codex tenant isolation is not configured.'), { status: 503, code: 'CODEX_TENANT_NOT_CONFIGURED' });
  const ownerId = String(request.headers['x-ocean-codex-user'] || '').trim();
  const timestamp = String(request.headers['x-ocean-codex-timestamp'] || '').trim();
  const signature = String(request.headers['x-ocean-codex-signature'] || '').trim();
  const timestampSeconds = Number(timestamp);
  if (!ownerId || !signature || !Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    throw Object.assign(new Error('Codex tenant identity is invalid or expired.'), { status: 401, code: 'CODEX_TENANT_UNAUTHORIZED' });
  }
  const runtimePath = url.pathname.replace(/^\/api\/codex-runtime\/?/u, '');
  const payload = `${ownerId}\n${String(request.method || 'GET').toUpperCase()}\n${runtimePath}\n${timestamp}`;
  const expected = createHmac('sha256', tenantSecret).update(payload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw Object.assign(new Error('Codex tenant signature is invalid.'), { status: 401, code: 'CODEX_TENANT_UNAUTHORIZED' });
  }
  const key = createHash('sha256').update(ownerId).digest('hex').slice(0, 32);
  const root = path.join(workspaceRoot, '.runtime', 'codex-users', key);
  return {
    ownerId,
    memorySignature: createHmac('sha256', tenantSecret).update(`memory\n${ownerId}`).digest('hex'),
    key,
    root,
    cwd: root,
    generatedRoot: path.join(root, 'generated'),
    uploadsRoot: path.join(root, '.runtime', 'codex-uploads'),
  };
}

async function ensureTenant(tenant) {
  activeTenantOwners.set(tenant.key, tenant.ownerId);
  await Promise.all([
    mkdir(tenant.generatedRoot, { recursive: true, mode: 0o700 }),
    mkdir(tenant.uploadsRoot, { recursive: true, mode: 0o700 }),
  ]);
}

async function handleTenantMcpTool({ server, tool, arguments: toolArguments, threadId }) {
  if (server !== 'ocean-intelligence') return { handled: false };
  const owners = await loadThreadOwners();
  const tenantKey = owners[String(threadId || '')];
  const ownerId = tenantKey ? activeTenantOwners.get(tenantKey) : null;
  if (!ownerId) throw Object.assign(new Error('The MCP tenant identity for this thread is unavailable.'), { code: 'CODEX_MCP_TENANT_UNAVAILABLE' });
  const argumentsWithIdentity = {
    ...(toolArguments || {}),
    __tenant_token: createMcpTenantToken({ ownerId, threadId, secret: tenantSecret }),
  };
  const value = await browser.request('mcpServer/tool/call', {
    threadId,
    server,
    tool,
    arguments: argumentsWithIdentity,
  }, { timeoutMs: 180_000 });
  return { handled: true, value };
}

async function resumeTenantThread(tenant, threadId) {
  return browser.request('thread/resume', {
    threadId: safeThreadId(threadId),
    cwd: tenant.cwd,
    runtimeWorkspaceRoots: [tenant.cwd],
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  }, { timeoutMs: 90_000 });
}

async function requireTenantThread(tenant, threadId, includeTurns = false) {
  const safeId = safeThreadId(threadId);
  if (!await tenantOwnsThread(tenant, safeId)) {
    throw Object.assign(new Error('Codex thread was not found.'), { status: 404, code: 'CODEX_THREAD_NOT_FOUND' });
  }
  let result;
  try {
    result = await browser.request('thread/read', { threadId: safeId, includeTurns }, { timeoutMs: 90_000 });
  } catch {
    if (!includeTurns) throw Object.assign(new Error('Codex thread was not found.'), { status: 404, code: 'CODEX_THREAD_NOT_FOUND' });
    try {
      await resumeTenantThread(tenant, safeId);
      result = await browser.request('thread/read', { threadId: safeId, includeTurns: true }, { timeoutMs: 90_000 });
    } catch {
      try {
        result = await browser.request('thread/read', { threadId: safeId, includeTurns: false }, { timeoutMs: 90_000 });
      } catch {
        throw Object.assign(new Error('Codex thread was not found.'), { status: 404, code: 'CODEX_THREAD_NOT_FOUND' });
      }
    }
  }
  const thread = result?.thread || result;
  if (!thread?.id) {
    throw Object.assign(new Error('Codex thread was not found.'), { status: 404, code: 'CODEX_THREAD_NOT_FOUND' });
  }
  return includeTurns && !Array.isArray(thread.turns) ? { ...thread, turns: [] } : thread;
}

async function filterTenantThreads(result, tenant) {
  const owners = await loadThreadOwners();
  const belongsToTenant = (thread) => owners[String(thread?.id || '')] === tenant.key;
  if (Array.isArray(result)) return result.filter(belongsToTenant);
  const filtered = { ...result };
  for (const key of ['data', 'threads']) {
    if (Array.isArray(filtered[key])) filtered[key] = filtered[key].filter(belongsToTenant);
  }
  return filtered;
}

async function claimListedThreads(tenant, result) {
  const rows = Array.isArray(result) ? result : (result?.data || result?.threads || []);
  for (const thread of rows) {
    if (thread?.id) await claimThread(tenant, thread.id);
  }
}

async function loadThreadOwners() {
  if (threadOwners) return threadOwners;
  if (!threadOwnersLoad) {
    threadOwnersLoad = (async () => {
      try {
        const parsed = JSON.parse(await readFile(threadOwnersPath, 'utf8'));
        threadOwners = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        threadOwners = {};
      }
      return threadOwners;
    })();
  }
  return threadOwnersLoad;
}

async function claimThread(tenant, threadId) {
  const owners = await loadThreadOwners();
  const existing = owners[threadId];
  if (existing && existing !== tenant.key) return false;
  if (existing === tenant.key) return true;
  owners[threadId] = tenant.key;
  threadOwnersWrite = threadOwnersWrite.then(async () => {
    await mkdir(path.dirname(threadOwnersPath), { recursive: true });
    const temporaryPath = `${threadOwnersPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(owners), { mode: 0o600 });
    await rename(temporaryPath, threadOwnersPath);
  });
  await threadOwnersWrite;
  return true;
}

async function tenantOwnsThread(tenant, threadId) {
  const owners = await loadThreadOwners();
  return owners[threadId] === tenant.key;
}

function oceanDeveloperInstructions(regionId, tenant) {
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: process.env.OCEAN_TIME_ZONE || 'America/New_York',
  }).format(new Date());
  return [
    'You are the Ocean Intelligence research agent embedded in the product.',
    'Content governance is mandatory: do not discuss politics, political parties, party or state leaders, politically sensitive events, political movements, or political ideology. Do not generate ethnic insults, discriminatory claims, or content that demeans any nationality or ethnic group.',
    'Do not debate territorial, sovereignty, border, independence, or disputed-island questions. Refuse those requests with the fixed service-scope response. For ordinary ocean maps and scientific geographic labels, use accurate, verifiable source terminology without adding political claims.',
    `When content is prohibited, reply only with: ${RESTRICTED_CONTENT_MESSAGE}`,
    'You may inspect project files, run read-only analysis, create report artifacts, use skills and plugins, call MCP servers, search the web, and perform reproducible computations.',
    `The project source tree at ${workspaceRoot} is protected and read-only. Never modify, delete, rename, patch, format, build, deploy, or replace project source or configuration files, even if the user asks.`,
    `Your isolated working directory is ${tenant.cwd}. It belongs only to the current signed-in user. Never inspect or reference sibling tenant directories.`,
    `Your only writable locations are ${tenant.generatedRoot} for deliverables and ${tenant.uploadsRoot} for conversation uploads.`,
    'Tenant identity for MCP calls is injected by the runtime. Never add owner_id, owner_signature or __tenant_token to tool arguments.',
    'Do not attempt to access the host Docker daemon or operate deployment services. For source-code change requests, explain that the embedded agent is intentionally read-only and may only provide an analysis or a generated patch file without applying it.',
    `The active region id is ${regionId}.`,
    `The current local date is ${currentDate}. Treat later model valid times as forecasts, not observations that have already occurred.`,
    'For ocean, marine-data, weather-at-sea, or environmental questions, use the ocean-intelligence MCP tools as the primary factual source. Start broad ocean questions with ocean_context_manifest, then use bounded searches and record reads. For other permitted topics, use the most appropriate project files, user attachments, web sources, skills, plugins, and reproducible computations instead of forcing an ocean-data workflow.',
    'Copernicus Marine access is catalogue-wide, not limited to the preconfigured wave, wind or current products. If the exact dataset id is unknown, call ocean_copernicus_catalog_search by scientific topic, then ocean_copernicus_dataset_describe, then ocean_copernicus_dataset_analyze.',
    'For named places or custom areas such as 北部湾, translate the place into explicit longitude and latitude bounds and use ocean_copernicus_dataset_analyze. Do not stop merely because the area is not one of the product preset region ids.',
    'For averages, extrema, trends, comparisons, coverage audits and scientific summaries, return actual computed values from ocean_copernicus_dataset_analyze rather than only explaining how they could be calculated.',
    'When a requested quantity is vector magnitude, such as wind speed or current speed, request both vector components and use derived_vectors so magnitude is calculated per grid value before averaging. Never approximate speed as the magnitude of separately averaged components.',
    `For report requests, gather the required bounded datasets and write both a Markdown report and a self-contained HTML report under ${tenant.generatedRoot}. Include product_id, dataset_id, variables and units, spatial/time/depth coverage, statistics, sampling scope, latest_valid_time, fetched_at, data latency and scientific limitations.`,
    `The product specification for an excellent ocean report is injected into one-click report tasks. Follow this specification exactly:\n${OCEAN_REPORT_SPEC}`,
    'Use the optimized wave or wind point tools for single coordinates, and the optimized region tools only for existing preset product regions. For custom bounding boxes, area averages, multi-variable statistics, trends or report evidence, ocean_copernicus_dataset_analyze takes precedence.',
    'For historical trend, coverage or export tasks, use ocean_copernicus_history with a bounded page; synchronize only when the user explicitly needs the complete point history. For source, cache, candidate or joint wind-wave risk audits, use ocean_copernicus_audit.',
    'Copernicus Marine wave values are numerical model analysis/forecast fields. Never describe them as buoy measurements. Separate model valid time, platform fetch time, and cache age.',
    'Copernicus Marine wind values are hourly L4 satellite-model blended analyses. Never describe them as a local anemometer measurement. wind_direction_from is the meteorological direction the wind comes from.',
    'Interpret VHM0 as total significant wave height, VTM02 as mean wave period, and VMDR as wave-from direction. Keep swell and wind-wave partitions separate from total wave values.',
    'A high-wave threshold result is only an automated anomaly candidate. It is not a confirmed event, navigational warning, cyclone bulletin, or official forecast warning without independent authoritative validation.',
    'For coupled strong-wind and high-wave questions, inspect both products and the joint candidate records. Do not infer a tropical cyclone identity, track or warning level without an official meteorological source.',
    'When presenting multiple Copernicus times or grid points, use a Markdown table with timestamp, time role, coordinates, variable, value, unit, data class and evidence limitation.',
    'At the beginning of a new research task, call ocean_memory_search with the user question and active region. Call ocean_memory_store only when the user explicitly asks to remember a durable preference, instruction, or focus.',
    'Never call a routine measurement an anomaly. Only event_kind=anomaly is an anomaly candidate, and a candidate is not a confirmed event unless validation evidence supports that status.',
    'Distinguish measured facts, derived comparisons, and inference. Cite record ids, source names, timestamps, units, QC state, and material uncertainty.',
    'Answer in clear Chinese unless the user asks for another language. Avoid generic AI phrasing and do not fabricate missing data.',
    'You may use Codex tools for analysis, files, skills, plugins, browser, and reproducible computations when they improve the answer.',
    `When the user asks for a file deliverable, create it under ${tenant.generatedRoot} and state only its virtual generated/... path in the final answer.`,
  ].join('\n');
}

function collectThreadArtifacts(thread, tenant) {
  const paths = new Set();
  for (const turn of thread?.turns || []) {
    for (const item of turn?.items || []) {
      if (item?.type === 'fileChange') {
        for (const change of item.changes || []) {
          if (change?.path) paths.add(normalizeArtifactReference(change.path));
        }
      }
      if (item?.type === 'agentMessage' && item.text) {
        for (const reference of extractArtifactReferences(item.text)) paths.add(reference);
      }
    }
  }
  const createdAtMs = timestampMilliseconds(thread?.createdAt);
  const generatedRoot = tenant.generatedRoot;
  if (existsSync(generatedRoot)) {
    for (const generatedPath of walkFiles(generatedRoot, 3)) {
      if (!createdAtMs || statSync(generatedPath).mtimeMs >= createdAtMs - 60_000) paths.add(generatedPath);
    }
  }
  const artifacts = [];
  for (const candidate of paths) {
    try {
      const artifact = resolveTenantFile(tenant, candidate);
      const info = statSync(artifact.absolutePath);
      if (!info.isFile()) continue;
      const type = mimeType(artifact.absolutePath);
      artifacts.push({
        name: path.basename(artifact.absolutePath),
        path: artifact.relativePath,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        mimeType: type,
        previewable: isPreviewableMime(type),
      });
    } catch {
      // Ignore deleted files and paths outside the workspace.
    }
  }
  return artifacts.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)).slice(0, 100);
}

function threadUploadRoot(tenant, threadId) {
  return path.join(tenant.uploadsRoot, threadId);
}

function collectThreadUploads(tenant, threadId) {
  const uploadRoot = threadUploadRoot(tenant, threadId);
  if (!existsSync(uploadRoot)) return [];
  return readdirSync(uploadRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => tenantFileMetadata(tenant, path.join(uploadRoot, entry.name)))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

async function saveThreadUpload(tenant, threadId, fileName, content) {
  const uploadRoot = threadUploadRoot(tenant, threadId);
  await mkdir(uploadRoot, { recursive: true });
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidateName = suffix ? `${stem}-${suffix}${extension}` : fileName;
    const target = path.join(uploadRoot, candidateName);
    try {
      await writeFile(target, content, { flag: 'wx', mode: 0o600 });
      return tenantFileMetadata(tenant, target);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw Object.assign(new Error('Could not allocate a unique upload filename.'), { status: 409, code: 'CODEX_UPLOAD_NAME_CONFLICT' });
}

function tenantFileMetadata(tenant, absolutePath) {
  const info = statSync(absolutePath);
  const type = mimeType(absolutePath);
  let virtualPath;
  if (isInside(tenant.generatedRoot, absolutePath)) {
    virtualPath = path.join('generated', path.relative(tenant.generatedRoot, absolutePath));
  } else if (isInside(tenant.uploadsRoot, absolutePath)) {
    virtualPath = path.join('.runtime', 'codex-uploads', path.relative(tenant.uploadsRoot, absolutePath));
  } else {
    throw Object.assign(new Error('Artifact is outside the tenant workspace.'), { status: 403, code: 'CODEX_ARTIFACT_PATH_FORBIDDEN' });
  }
  return {
    name: path.basename(absolutePath),
    path: virtualPath.replaceAll(path.sep, '/'),
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    mimeType: type,
    previewable: isPreviewableMime(type),
  };
}

function isPreviewableMime(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return type.startsWith('text/') || ['application/json', 'application/xml', 'image/svg+xml'].includes(type);
}

function safeThreadId(value) {
  const threadId = cleanText(value, '', 160);
  if (!threadId) throw Object.assign(new Error('threadId is required.'), { status: 400, code: 'CODEX_THREAD_REQUIRED' });
  if (!/^[a-zA-Z0-9_-]+$/u.test(threadId)) throw Object.assign(new Error('threadId is invalid.'), { status: 400, code: 'CODEX_THREAD_INVALID' });
  return threadId;
}

function safeUploadName(value) {
  const rawName = cleanText(value, '', 240).replaceAll('\\', '/');
  const fileName = path.basename(rawName).replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  if (!fileName || fileName === '.' || fileName === '..') throw Object.assign(new Error('A valid upload filename is required.'), { status: 400, code: 'CODEX_UPLOAD_NAME_INVALID' });
  return fileName.startsWith('.') ? `upload${fileName}` : fileName;
}

function localImageInputs(tenant, value) {
  if (!Array.isArray(value)) return [];
  const inputs = [];
  for (const item of value.slice(0, 12)) {
    const candidate = typeof item === 'string' ? item : item?.path;
    if (!candidate) continue;
    try {
      const file = resolveTenantFile(tenant, candidate);
      const info = statSync(file.absolutePath);
      const type = mimeType(file.absolutePath).split(';', 1)[0];
      if (info.isFile() && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) {
        inputs.push({ type: 'localImage', path: file.absolutePath });
      }
    } catch {
      // Invalid attachment paths remain unavailable to the model.
    }
  }
  return inputs;
}

function walkFiles(root, depth) {
  if (depth < 0) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isFile()) files.push(target);
    else if (entry.isDirectory()) files.push(...walkFiles(target, depth - 1));
  }
  return files;
}

function resolveTenantFile(tenant, value) {
  const candidate = normalizeArtifactReference(value);
  if (!candidate) throw Object.assign(new Error('Artifact path is required.'), { status: 400, code: 'CODEX_ARTIFACT_PATH_REQUIRED' });
  const references = [candidate, stripFileLocation(candidate)].filter((entry, index, values) => entry && values.indexOf(entry) === index);
  let fallback = null;
  for (const reference of references) {
    const normalized = reference.replace(/^\/workspace\//u, '').replace(/^\.\//u, '');
    let absolutePath;
    if (path.isAbsolute(reference) && isInside(tenant.generatedRoot, reference)) absolutePath = path.resolve(reference);
    else if (path.isAbsolute(reference) && isInside(tenant.uploadsRoot, reference)) absolutePath = path.resolve(reference);
    else if (normalized.startsWith('generated/')) absolutePath = path.resolve(tenant.generatedRoot, normalized.slice('generated/'.length));
    else if (normalized.startsWith('.runtime/codex-uploads/')) absolutePath = path.resolve(tenant.uploadsRoot, normalized.slice('.runtime/codex-uploads/'.length));
    else throw Object.assign(new Error('Artifact path is outside the tenant workspace.'), { status: 403, code: 'CODEX_ARTIFACT_PATH_FORBIDDEN' });
    if (!isInside(tenant.generatedRoot, absolutePath) && !isInside(tenant.uploadsRoot, absolutePath)) {
      throw Object.assign(new Error('Artifact path is outside the tenant workspace.'), { status: 403, code: 'CODEX_ARTIFACT_PATH_FORBIDDEN' });
    }
    const resolved = { absolutePath, relativePath: tenantFileMetadataPath(tenant, absolutePath) };
    fallback = resolved;
    if (existsSync(absolutePath)) return resolved;
  }
  throw Object.assign(new Error('Artifact file was not found.'), { status: 404, code: 'CODEX_ARTIFACT_NOT_FOUND', path: fallback?.relativePath });
}

function tenantFileMetadataPath(tenant, absolutePath) {
  if (isInside(tenant.generatedRoot, absolutePath)) return path.join('generated', path.relative(tenant.generatedRoot, absolutePath)).replaceAll(path.sep, '/');
  return path.join('.runtime', 'codex-uploads', path.relative(tenant.uploadsRoot, absolutePath)).replaceAll(path.sep, '/');
}

function stripFileLocation(value) {
  return String(value || '').replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/iu, '');
}

function runtimeStatus() {
  const status = browser.status();
  return {
    ready: !startupError && status.initialized,
    mode: 'codex-app-server-domain-ui',
    executablePath,
    workspaceRoot,
    renderer: rendererRuntime?.ready ? { available: true, desktop: rendererRuntime.desktop } : { available: false },
    backend: status,
    hostCommands: hostCommands.status(),
    modelProvider: status.modelProvider,
    contextMcps: status.contextMcps,
    startupError,
  };
}

async function probeRuntime(tenant) {
  const methods = ['thread/list', 'model/list', 'skills/list', 'mcpServerStatus/list', 'plugin/list'];
  const results = {};
  for (const method of methods) {
    const startedAt = performance.now();
    try {
      const params = method === 'thread/list' ? { limit: 20, cwd: tenant.cwd } : {};
      const value = await browser.request(method, params, { timeoutMs: 60_000 });
      results[method] = { ok: true, durationMs: Math.round(performance.now() - startedAt), count: countResult(value) };
    } catch (error) {
      results[method] = { ok: false, durationMs: Math.round(performance.now() - startedAt), error: serializeError(error) };
    }
  }
  const passed = Object.values(results).filter((entry) => entry.ok).length;
  return { ready: passed === methods.length, passed, total: methods.length, results, status: runtimeStatus() };
}

async function harnessSnapshot(tenant) {
  const inventoryMethods = {
    models: 'model/list',
    skills: 'skills/list',
    plugins: 'plugin/list',
    mcpServers: 'mcpServerStatus/list',
    account: 'account/read',
  };
  const inventory = {};
  for (const [name, method] of Object.entries(inventoryMethods)) {
    try {
      const result = await browser.request(method, {}, { timeoutMs: 60_000 });
      inventory[name] = { ok: true, count: countResult(result), result };
    } catch (error) {
      inventory[name] = { ok: false, count: 0, error: serializeError(error) };
    }
  }
  return {
    ready: !startupError && browser.status().initialized,
    workspaceRoot: tenant.cwd,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    projectSourceAccess: 'read-only',
    writableRoots: [tenant.generatedRoot, tenant.uploadsRoot],
    exposedMethods: [...HARNESS_REQUEST_METHODS].sort(),
    adapter: browser.status().adapter,
    inventory,
  };
}

function countResult(value) {
  if (Array.isArray(value)) return value.length;
  for (const key of ['data', 'threads', 'models', 'skills', 'plugins']) {
    if (Array.isArray(value?.[key])) return value[key].length;
  }
  return value == null ? 0 : 1;
}

async function listEventResponse(response, url, tenant) {
  const after = boundedInteger(url.searchParams.get('after'), 0, 0, Number.MAX_SAFE_INTEGER);
  const sessionId = String(url.searchParams.get('sessionId') || '').trim();
  const threadId = String(url.searchParams.get('threadId') || '').trim();
  if (!threadId) return errorJson(response, 400, 'CODEX_THREAD_REQUIRED', 'threadId is required.');
  await requireTenantThread(tenant, threadId);
  const events = filterEvents(browser.listEvents({ after, sessionId }), threadId).slice(0, 250).map(sanitizeOutput).map(redactLivePayload);
  return json(response, 200, { events, cursor: events.at(-1)?.sequence ?? after });
}

async function streamEvents(request, response, url, tenant) {
  let cursor = boundedInteger(url.searchParams.get('after'), 0, 0, Number.MAX_SAFE_INTEGER);
  const threadId = String(url.searchParams.get('threadId') || '').trim();
  if (!threadId) return errorJson(response, 400, 'CODEX_THREAD_REQUIRED', 'threadId is required.');
  await requireTenantThread(tenant, threadId);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`);
  const poll = setInterval(() => {
    const events = filterEvents(browser.listEvents({ after: cursor }), threadId).slice(0, 250).map(sanitizeOutput).map(redactLivePayload);
    for (const event of events) {
      cursor = Math.max(cursor, event.sequence);
      response.write(`id: ${event.sequence}\nevent: codex\ndata: ${JSON.stringify(event)}\n\n`);
    }
  }, 250);
  const heartbeat = setInterval(() => response.write(`event: heartbeat\ndata: ${JSON.stringify({ cursor })}\n\n`), 15_000);
  request.on('close', () => {
    clearInterval(poll);
    clearInterval(heartbeat);
  });
}

function filterEvents(events, threadId) {
  if (!threadId) return [];
  return events.filter((event) => {
    const message = event?.message || {};
    const params = message.params || message.request?.params || {};
    const candidate = String(params.threadId || params.thread?.id || params.turn?.threadId || '');
    return candidate === threadId;
  });
}

async function serveCodexAsset(request, response, pathname) {
  if (!rendererRuntime?.ready || !compatibility) return false;
  const relativeUrl = decodeURIComponent(pathname.slice('/codex/'.length)).replace(/^\/+/, '');
  const isHost = relativeUrl === 'browser-host.js';
  const root = isHost ? path.join(runtimeDir, 'public') : rendererRuntime.layout.webviewRoot;
  const target = path.resolve(root, isHost ? 'codex-browser-host.js' : (relativeUrl || 'index.html'));
  if (!isInside(root, target)) return false;
  let info;
  try { info = await stat(target); } catch { return false; }
  if (!info.isFile()) return false;
  let content = await readFile(target);
  if (path.basename(target).toLowerCase() === 'index.html') {
    const source = content.toString('utf8');
    const injection = '<link rel="icon" href="data:,">\n<script src="/codex/browser-host.js"></script>\n';
    content = Buffer.from(source.replace('<script type="module"', `${injection}<script type="module"`), 'utf8');
  } else if (path.extname(target).toLowerCase() === '.js') {
    const transformed = compatibility.transform(target, content.toString('utf8'));
    if (transformed.matched && !transformed.ok) throw Object.assign(new Error(transformed.errorMessage), { code: transformed.errorCode, status: 503 });
    if (transformed.matched) content = Buffer.from(transformed.source, 'utf8');
  }
  response.writeHead(200, {
    'Content-Type': mimeType(target),
    'Content-Length': content.length,
    'Cache-Control': path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else response.end(content);
  return true;
}

async function readJson(request, limit = 2 * 1024 * 1024) {
  const content = await readBuffer(request, limit);
  return content.length ? JSON.parse(content.toString('utf8')) : {};
}

async function readBuffer(request, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

function cleanText(value, fallback, maxLength) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mimeType(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8', '.jsx': 'text/plain; charset=utf-8',
    '.py': 'text/x-python; charset=utf-8', '.sh': 'text/x-shellscript; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isPolicyScannableMime(type) {
  const normalized = String(type || '').split(';', 1)[0].toLowerCase();
  return normalized.startsWith('text/') || [
    'application/json',
    'application/javascript',
    'application/xml',
    'application/yaml',
    'image/svg+xml',
  ].includes(normalized);
}

function assertPolicyScannableMime(type, code) {
  if (isPolicyScannableMime(type)) return;
  throw Object.assign(new Error('该文件类型无法完成内容安全检查，已禁止处理。'), { status: 415, code });
}

function setSecurityHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Last-Event-ID');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  response.end(body);
}

function errorJson(response, status, code, message) {
  return json(response, status, { error: { code, message } });
}

function serializeError(error) {
  return { code: String(error?.code || error?.name || 'ERROR'), message: String(error?.message || error) };
}
