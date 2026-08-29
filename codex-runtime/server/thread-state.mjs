export function threadStatusType(status) {
  if (typeof status === 'string') return status.trim();
  return String(status?.type || '').trim();
}

export function isThreadNotLoaded(thread) {
  return threadStatusType(thread?.status).replace(/[_\s-]/gu, '').toLowerCase() === 'notloaded';
}
