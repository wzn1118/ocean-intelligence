export const RESTRICTED_CONTENT_MESSAGE = '该请求超出海洋科研助手的服务范围，无法处理。';
export const UNSUPPORTED_TONE_MESSAGE = '请使用积极、专业、建设性的表述。';

const RESTRICTED_PATTERNS = [
  /政治|政党|共产党|中共|党和国家领导人|国家领导人|领导人|总书记|国家主席|总统|总理|首相|议会|选举|政权|意识形态|外交政策|政治制裁|政变|示威|政治抗议|民主运动/iu,
  /领土争议|主权争议|边界争议|岛屿争议|海洋权益争议|分裂国家|独立运动|统一问题|台独|港独|藏独|疆独|南海仲裁|钓鱼岛.{0,12}争议|台湾.{0,16}(?:主权|独立|统一|国家)/iu,
  /敏感事件|政治事件|历史事件.{0,20}(?:镇压|屠杀|暴乱)/iu,
  /侮辱民族|民族.{0,12}(?:低等|劣等|野蛮|愚蠢|垃圾|该死)|种族歧视|民族仇恨/iu,
  /\b(?:politics?|political party|communist party|state leader|national leader|president|prime minister|election|political regime|regime change|coup|political protest|territorial dispute|sovereignty dispute|ethnic slur|ethnic hatred)\b/iu,
];

const NEGATIVE_TONE_PATTERNS = [
  /悲观|绝望|无望|彻底失败|一败涂地|末日|毁灭|崩溃|完蛋|没救|无药可救|注定失败|前途渺茫|令人绝望|灾难性结论/iu,
  /彻底否定|恶意攻击|污名化|煽动仇恨|幸灾乐祸|冷嘲热讽|阴阳怪气/iu,
  /\b(?:hopeless|despair|doomed|disaster|catastrophic conclusion|total failure|hate speech)\b/iu,
];

const ZERO_WIDTH_PATTERN = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;
const SEPARATOR_PATTERN = /[\p{Z}\p{P}\p{S}_]+/gu;
const LIVE_TEXT_KEYS = new Set(['text', 'delta', 'content', 'output', 'aggregatedOutput', 'summary', 'query', 'command']);
const RESTRICTED_COMPACT_TERMS = [
  '政治', '政党', '共产党', '中共', '国家领导人', '总书记', '国家主席', '总统', '总理', '首相', '议会', '选举', '政权',
  '领土争议', '主权争议', '边界争议', '岛屿争议', '南海仲裁', '敏感事件', '政治事件', '侮辱民族', '种族歧视', '民族仇恨',
  'politics', 'politicalparty', 'communistparty', 'stateleader', 'nationalleader', 'president', 'primeminister', 'election',
  'politicalregime', 'regimechange', 'territorialdispute', 'sovereigntydispute', 'ethnicslur', 'ethnichatred',
];

function normalizedForms(value) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase().replace(ZERO_WIDTH_PATTERN, '');
  const compact = normalized.replace(SEPARATOR_PATTERN, '');
  const latinFolded = compact.replace(/[013457@$]/gu, (character) => ({
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '@': 'a',
    '$': 's',
  })[character] || character);
  return [normalized, compact, latinFolded];
}

export function containsRestrictedContent(value) {
  return normalizedForms(value).some((text) => text.length > 0 && (
    RESTRICTED_PATTERNS.some((pattern) => pattern.test(text))
    || RESTRICTED_COMPACT_TERMS.some((term) => text.includes(term))
  ));
}

export function containsNegativeTone(value) {
  return normalizedForms(value).some((text) => NEGATIVE_TONE_PATTERNS.some((pattern) => pattern.test(text)));
}

export function normalizeApprovedGeography(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/(?<!中国)台湾/gu, '中国台湾');
}

export function sanitizeOutput(value) {
  if (typeof value === 'string') {
    if (containsRestrictedContent(value)) return RESTRICTED_CONTENT_MESSAGE;
    if (containsNegativeTone(value)) return UNSUPPORTED_TONE_MESSAGE;
    return normalizeApprovedGeography(value);
  }
  if (Array.isArray(value)) return value.map(sanitizeOutput);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeOutput(entry)]));
}

export function assertPermittedContent(value) {
  if (!containsRestrictedContent(value)) return;
  throw Object.assign(new Error(RESTRICTED_CONTENT_MESSAGE), {
    status: 422,
    code: 'CODEX_CONTENT_RESTRICTED',
  });
}

export function sanitizeRestrictedPayload(value) {
  if (typeof value === 'string') return containsRestrictedContent(value) ? RESTRICTED_CONTENT_MESSAGE : normalizeApprovedGeography(value);
  if (Array.isArray(value)) return value.map(sanitizeRestrictedPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeRestrictedPayload(entry)]));
}

export function redactLivePayload(value, key = '') {
  if (LIVE_TEXT_KEYS.has(key)) return typeof value === 'string' ? '' : Array.isArray(value) ? [] : value && typeof value === 'object' ? {} : value;
  if (Array.isArray(value)) return value.map((entry) => redactLivePayload(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, redactLivePayload(entry, entryKey)]));
}
