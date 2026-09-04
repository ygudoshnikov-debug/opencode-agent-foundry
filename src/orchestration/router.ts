import type { FoundryConfig } from '../config/schema.js';
import type { Role, Task } from '../core/types.js';

/**
 * Routing and cost accounting.
 *
 * Routing decides which ROLE should handle a piece of work. It never mentions a
 * model: which model a role runs on is configuration, resolved elsewhere.
 */

export type Complexity = 'trivial' | 'moderate' | 'architectural' | 'global';

export interface RoutingContext {
  complexity: Complexity;
  touchesPublicContract?: boolean;
  crossModule?: boolean;
  failures?: number;
}

/**
 * Cheapest competent role first, escalating only when the evidence says the
 * cheaper one cannot finish. Repeated failure is itself a routing signal:
 * a role failing three times costs more than starting one level up.
 */
export function routeTask(context: RoutingContext): Role {
  const failures = context.failures ?? 0;
  if (failures >= 3) return 'architect';
  if (failures === 2) return 'lead';
  if (context.complexity === 'global' || (context.crossModule && context.complexity === 'architectural')) {
    return 'architect';
  }
  if (context.complexity === 'architectural' || context.crossModule) return 'lead';
  if (context.complexity === 'moderate' || context.touchesPublicContract) return 'analyst';
  return 'builder';
}

/** Next role up the chain, or null at the top. */
export function escalationTarget(from: Role | string): Role | null {
  switch (from) {
    case 'builder':
      return 'analyst';
    case 'analyst':
      return 'lead';
    case 'lead':
      return 'architect';
    default:
      return null;
  }
}

/**
 * Situations that genuinely need a human. Everything else the orchestrator
 * decides itself — asking about the obvious is its own kind of waste.
 */
export type HumanCheckpoint = 'destructive' | 'contract' | 'ambiguity' | 'external' | 'conflict';

export function needsHuman(kind: HumanCheckpoint): boolean {
  return (['destructive', 'contract', 'ambiguity', 'external', 'conflict'] as HumanCheckpoint[]).includes(kind);
}

/** Fallback price when a model has no entry in `pricing`. */
const DEFAULT_RATE = { input_per_1k: 0.002, output_per_1k: 0.008 } as const;

/**
 * Cost estimate. The price table lives in user config keyed by the same opaque
 * model id used for role bindings, so no vendor pricing is compiled in and an
 * unknown model degrades to a generic rate instead of reporting zero.
 */
export function estimateCost(
  config: FoundryConfig,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = (model && config.pricing[model]) || DEFAULT_RATE;
  return (inputTokens / 1000) * rate.input_per_1k + (outputTokens / 1000) * rate.output_per_1k;
}

/**
 * Rough token estimate for a task's execution packet. Deliberately cheap: it
 * exists to make cost visible and to trip the configured guards, not to be
 * exact.
 */
export function estimateTokensForTask(task: Task): { input: number; output: number } {
  const packetSize =
    task.title.length +
    task.objective.length +
    task.allowed_files.join('').length +
    task.acceptance_criteria.join('').length +
    (task.verification?.length ?? 0);
  const historySize = task.history.reduce(
    (total, attempt) => total + (attempt.error_summary?.length ?? 0) + (attempt.evidence?.output_summary?.length ?? 0),
    0,
  );
  return {
    input: Math.ceil((packetSize + historySize) / 4) + 1500,
    output: 700,
  };
}

export interface CostGuard {
  ok: boolean;
  reason?: string;
}

/** Enforces the configured spend ceilings. A limit of 0 disables that guard. */
export function checkCostLimits(
  config: FoundryConfig,
  taskCostUsd: number,
  projectTotalUsd: number,
): CostGuard {
  const { max_cost_per_task_usd: perTask, max_cost_per_project_usd: perProject } = config.limits;
  if (perTask > 0 && taskCostUsd > perTask) {
    return { ok: false, reason: `task cost $${taskCostUsd.toFixed(4)} exceeds the $${perTask} limit` };
  }
  if (perProject > 0 && projectTotalUsd > perProject) {
    return { ok: false, reason: `project cost $${projectTotalUsd.toFixed(4)} exceeds the $${perProject} limit` };
  }
  return { ok: true };
}
