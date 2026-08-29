const TRAILING_LOCATION = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/iu;
const TRAILING_PUNCTUATION = /[),.;!?，。；！？]+$/u;

export function normalizeArtifactReference(value) {
  const candidate = String(value || '')
    .trim()
    .replace(/^['"`(（]+/u, '')
    .replace(TRAILING_PUNCTUATION, '')
    .replace(TRAILING_LOCATION, '');
  if (!candidate) return '';

  const generatedMatch = candidate.match(/^(?:\/workspace\/)?\.runtime\/codex-users\/[^/]+\/(generated\/.*)$/u);
  if (generatedMatch) return generatedMatch[1];
  const uploadMatch = candidate.match(/^(?:\/workspace\/)?\.runtime\/codex-users\/[^/]+\/\.runtime\/(codex-uploads\/.*)$/u);
  if (uploadMatch) return `.runtime/${uploadMatch[1]}`;
  return candidate.replace(/^\/workspace\//u, '').replace(/^\.\//u, '');
}

export function extractArtifactReferences(text) {
  const source = String(text || '');
  const references = new Set();
  const patterns = [
    /\[[^\]]+\]\(((?:\/workspace\/)?(?:\.runtime\/codex-users\/[^/]+\/)?(?:generated|\.runtime\/codex-uploads)\/[^)\s]+)\)/gu,
    /(?:\/workspace\/)?(?:\.runtime\/codex-users\/[^/]+\/)?(?:generated|\.runtime\/codex-uploads)\/[^\s`"'<>）)]+/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const reference = normalizeArtifactReference(match[1] || match[0]);
      if (reference) references.add(reference);
    }
  }
  return [...references];
}

export function timestampMilliseconds(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
