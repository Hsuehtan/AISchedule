export type AgentPollingState = {
  elapsedMs: number;
  pageVisible: boolean;
  terminal: boolean;
};

export function agentPollingInterval({
  elapsedMs,
  pageVisible,
  terminal,
}: AgentPollingState): number | false {
  if (!pageVisible || terminal) return false;
  if (elapsedMs < 10_000) return 1_000;
  if (elapsedMs < 30_000) return 2_000;
  return 5_000;
}
