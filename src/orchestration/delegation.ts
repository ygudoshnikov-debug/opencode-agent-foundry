import { buildPacket } from '../context/packet.js';
import { WorkGraph } from '../core/graph.js';
import type { ProjectState, Task } from '../core/types.js';
import type { FoundryConfig, ConfigurableRole } from '../config/schema.js';
import { ROLE_TOOLS, type DispatchResult, type Host } from '../runtime/host.js';

/**
 * Delegation.
 *
 * The orchestrator used to delegate by writing "@builder" into a chat message
 * and re-typing the context packet underneath it. That cost the packet twice —
 * once as the orchestrator's output, once as the role's input — and left the
 * exact wording at the mercy of whatever the orchestrator chose to paraphrase.
 *
 * Here the plugin builds the packet and sends it to the role itself. The packet
 * never enters the orchestrator's context at all, the role receives exactly
 * what the code decided to send, and the model is read from configuration at
 * this instant rather than frozen at agent-registration time.
 */

export interface DelegationRequest {
  role: ConfigurableRole;
  sessionID: string;
  directory: string;
  config: FoundryConfig;
  project: ProjectState;
  tasks: readonly Task[];
  /** The task in focus. Required for a builder; optional context otherwise. */
  task?: Task;
  /** Extra instruction from the orchestrator — its actual question or brief. */
  brief?: string;
  signal?: AbortSignal;
}

export interface DelegationOutcome extends DispatchResult {
  role: ConfigurableRole;
  /** What the packet cost, so waste is visible rather than inferred. */
  estimated_tokens: number;
  truncated: boolean;
}

function title(role: ConfigurableRole, task?: Task): string {
  return task ? `${role}: ${task.id} ${task.title}`.slice(0, 80) : `${role} consultation`;
}

/**
 * Builds the packet for a role and runs it.
 *
 * The packet is the whole contract: a role receives its scope and nothing else,
 * budgeted by `context.<role>` in configuration. Nothing about the wider
 * conversation leaks in, which is what keeps a builder's context small enough
 * to stay cheap and predictable.
 */
export async function delegate(request: DelegationRequest, host: Host): Promise<DelegationOutcome> {
  const graph = new WorkGraph(request.tasks);
  const packet = buildPacket({
    project: request.project,
    graph,
    role: request.role,
    config: request.config,
    ...(request.task ? { task: request.task } : {}),
    ...(request.brief ? { notes: [request.brief] } : {}),
  });

  const result = await host.dispatch({
    role: request.role,
    parentSessionID: request.sessionID,
    directory: request.directory,
    title: title(request.role, request.task),
    prompt: packet.text,
    model: request.config.models[request.role] ?? '',
    tools: ROLE_TOOLS[request.role],
    ...(request.signal ? { signal: request.signal } : {}),
  });

  return {
    ...result,
    role: request.role,
    estimated_tokens: packet.estimated_tokens,
    truncated: packet.truncated,
  };
}

/**
 * Runs several delegations at once, bounded by the configured builder count.
 *
 * A ceiling of 0 means unlimited, in which case everything the caller handed us
 * runs together — the graph and the file locks are the only limits, which is
 * what the scheduler already enforced before these tasks were chosen.
 */
export async function delegateMany(
  requests: readonly DelegationRequest[],
  host: Host,
  ceiling: number,
): Promise<DelegationOutcome[]> {
  if (requests.length === 0) return [];
  const limit = ceiling <= 0 ? requests.length : Math.min(ceiling, requests.length);

  const outcomes: DelegationOutcome[] = new Array(requests.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= requests.length) return;
      outcomes[index] = await delegate(requests[index]!, host);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return outcomes;
}
