import type { AgentEvent, AgentOptions } from "../decide/contracts";

export async function emitEvent<TData>(
  options: AgentOptions<TData>,
  event: AgentEvent<TData>,
): Promise<void> {
  if (!options.onEvent) return;
  await options.onEvent(event);
}
