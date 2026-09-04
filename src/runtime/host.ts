import type { ConfigurableRole, Role } from '../core/types.js';
import type { ModelOption } from '../desktop/protocol.js';

/**
 * The seam between the plugin and OpenCode itself.
 *
 * Everything the plugin needs from the host lives behind this interface: which
 * models exist, what model the current chat is on, and how to run a sub-agent.
 * Two reasons it is an interface rather than direct SDK calls:
 *
 * - the engine stays testable without a running OpenCode, and
 * - the SDK surface we depend on is written down in one place, so a change in
 *   OpenCode breaks compilation here rather than at a dozen call sites.
 */

export interface DispatchRequest {
  /** The role to run. Selects the registered agent's prompt and permissions. */
  role: ConfigurableRole;
  /** Session the work belongs to, so the run is nested under the conversation. */
  parentSessionID: string;
  /** Project directory for the child session. */
  directory: string;
  /** Short label shown in the UI for the child session. */
  title: string;
  /** The complete context. Nothing else is sent. */
  prompt: string;
  /**
   * Model to run on, as "<providerID>/<modelID>". Empty means "whatever the
   * parent conversation is using" — resolved live, not at registration time.
   */
  model: string;
  /** Tools the role may use. Absent means the host default for that agent. */
  tools?: Record<string, boolean>;
  signal?: AbortSignal;
}

export interface DispatchResult {
  ok: boolean;
  /** The role's answer, flattened to text. */
  text: string;
  /** Child session id, so the human can open the full transcript. */
  sessionID?: string;
  model?: string;
  error?: string;
}

export interface Host {
  /** Models OpenCode can actually reach right now. Empty when unavailable. */
  catalogue(): Promise<ModelOption[]>;
  /** The model the given conversation is running on, as "provider/model". */
  sessionModel(sessionID: string): Promise<string | null>;
  /** Runs one role to completion and returns its answer. */
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
}

/** Splits "provider/model" without losing model ids that contain slashes. */
export function parseModel(id: string): { providerID: string; modelID: string } | null {
  const trimmed = id.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return { providerID: trimmed.slice(0, slash), modelID: trimmed.slice(slash + 1) };
}

export function formatModel(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

/**
 * Tools each role may call when dispatched.
 *
 * A builder that could reach the planning tools would be able to rewrite the
 * board it is supposed to be executing, and a role that could dispatch would
 * recurse. Restricting here is cheaper and more reliable than instructing the
 * model not to.
 */
export const ROLE_TOOLS: Readonly<Record<ConfigurableRole, Record<string, boolean>>> = {
  architect: { foundry_dispatch: false, foundry_setup: false, foundry_config: false },
  lead: { foundry_dispatch: false, foundry_setup: false, foundry_config: false },
  analyst: { foundry_dispatch: false, foundry_setup: false, foundry_config: false },
  builder: {
    foundry_dispatch: false,
    foundry_setup: false,
    foundry_config: false,
    foundry_plan: false,
    foundry_apply_plan: false,
    foundry_next: false,
    foundry_start_task: false,
    foundry_ask: false,
    foundry_answer: false,
  },
};

/** A host that cannot reach OpenCode. Used in tests and headless contexts. */
export const OFFLINE_HOST: Host = {
  async catalogue() {
    return [];
  },
  async sessionModel() {
    return null;
  },
  async dispatch() {
    return {
      ok: false,
      text: '',
      error: 'no OpenCode host is available in this context',
    };
  },
};

export type { ConfigurableRole, Role };
