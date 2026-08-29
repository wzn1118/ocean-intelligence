const normalizedStatus = (value) => String(value || '').replace(/[_\s-]/gu, '').toLowerCase();

export function inspectThreadRecovery(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const itemCount = turns.reduce((total, turn) => total + (Array.isArray(turn?.items) ? turn.items.length : 0), 0);
  const meaningfulTurn = [...turns].reverse().find((turn) => Array.isArray(turn?.items) && turn.items.length > 0) || turns.at(-1) || null;
  const meaningfulStatus = normalizedStatus(meaningfulTurn?.status);
  const hasUserContext = turns.some((turn) => (turn?.items || []).some((item) => item?.type === 'userMessage'));
  const needsContinuation = ['interrupted', 'failed', 'error', 'cancelled', 'canceled'].includes(meaningfulStatus);

  return {
    verified: turns.length === 0 || hasUserContext,
    turnCount: turns.length,
    itemCount,
    hasUserContext,
    meaningfulTurnId: meaningfulTurn?.id || null,
    meaningfulTurnStatus: meaningfulTurn?.status || null,
    needsContinuation,
  };
}
