import { AGENT_PROMPTS } from './prompts.js';
import { modelFor, type FoundryConfig } from '../config/schema.js';
import { CONFIGURABLE_ROLES, type ConfigurableRole, type Role } from '../core/types.js';

/**
 * Agent definitions.
 *
 * Two invariants this file exists to enforce:
 *
 * 1. An agent's name is its ORGANISATIONAL FUNCTION. There is no model, vendor
 *    or version name anywhere in this file, and none may be added.
 * 2. `model` is present only when the user configured one. The orchestrator
 *    never has it, so OpenCode resolves it to the model selected in the chat —
 *    which is exactly the desired behaviour, achieved by omission rather than
 *    by a second configuration surface.
 */

export interface AgentDef {
  name: Role;
  description: string;
  mode: 'primary' | 'subagent';
  prompt: string;
  /** Absent means "inherit the model currently selected in the chat". */
  model?: string;
}

const DESCRIPTIONS: Record<Role, string> = {
  orchestrator:
    'Agent Foundry entry point. Describe an objective: the orchestrator clarifies requirements, plans the work onto a Kanban board, dispatches specialized roles and reports back. Runs on the model selected in this chat.',
  architect: 'Project scope: strategy, architecture, module split, acceptance criteria.',
  lead: 'Module scope: decomposes epics, owns module contracts and cross-module dependencies.',
  analyst: 'Functionality scope: turns a module slice into precise, verifiable tasks and reviews the result.',
  builder: 'Task scope: implements exactly one task inside its declared files and returns evidence.',
};

export function createAgentDefs(config: FoundryConfig): AgentDef[] {
  const orchestrator: AgentDef = {
    name: 'orchestrator',
    description: DESCRIPTIONS.orchestrator,
    mode: 'primary',
    prompt: AGENT_PROMPTS.orchestrator,
    // No `model` key on purpose. See the invariant above.
  };

  const subagents = CONFIGURABLE_ROLES.map((role: ConfigurableRole): AgentDef => {
    const model = modelFor(config, role);
    return {
      name: role,
      description: DESCRIPTIONS[role],
      mode: 'subagent',
      prompt: AGENT_PROMPTS[role],
      ...(model ? { model } : {}),
    };
  });

  return [orchestrator, ...subagents];
}

/**
 * Shapes an AgentDef into the object OpenCode's config hook expects. Only
 * emits `model` when one is bound, so an unbound role inherits the chat model.
 */
export function toOpenCodeAgent(def: AgentDef): Record<string, unknown> {
  return {
    description: def.description,
    mode: def.mode,
    prompt: def.prompt,
    ...(def.model ? { model: def.model } : {}),
    // The orchestrator is the human's interlocutor, so it may ask questions.
    // Sub-agents must not interrupt: they report upward instead.
    permission: def.name === 'orchestrator' ? { question: 'allow' } : { question: 'deny' },
  };
}
