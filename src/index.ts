import type { Plugin } from '@opencode-ai/plugin';
import { loadConfig } from './config/loader.js';
import { defaultConfig } from './config/schema.js';
import { createAgentDefs, toOpenCodeAgent } from './agents/index.js';
import { createFoundryTools } from './tools/definitions.js';
import { DesktopLifecycle } from './desktop/lifecycle.js';
import { createOpencodeHost } from './runtime/opencode-host.js';
import { OFFLINE_HOST } from './runtime/host.js';
import { SessionGate, SetupRequest } from './runtime/setup.js';

/**
 * opencode-agent-foundry — plugin entrypoint.
 *
 * Registration facts this file depends on (verified against @opencode-ai/plugin
 * 1.18.x): `Hooks` exposes `tool`, `config`, `event` and `dispose`, but has no
 * `agent` key — agents and commands are contributed by mutating the object the
 * `config` hook receives. An agent definition with no `model` inherits the
 * model selected in the chat, which is how the orchestrator gets its model
 * without a second configuration surface.
 */

interface CommandDef {
  name: string;
  description: string;
  template: string;
}

/**
 * Slash commands. One entry per thing a person actually wants to do; the
 * per-mode commands are gone along with the modes themselves.
 */
const COMMANDS: CommandDef[] = [
  {
    name: 'foundry',
    description: 'Agent Foundry: describe an objective and let the orchestrator run it',
    template:
      'Act as the Agent Foundry orchestrator. Objective: $ARGUMENTS\n\n' +
      'Start with foundry_setup(action="status") as always. Then foundry_start, work out what is ' +
      'genuinely unclear, record it with foundry_ask and put it to me as one numbered list. Do not ' +
      'plan before I answer unless nothing is actually ambiguous.',
  },
  {
    name: 'foundry-setup',
    description: 'Keep the current setup, or open the window to change it',
    template:
      'Call foundry_setup(action="status") and show me what is in effect. Offer the two answers: ' +
      'keep it, or open the window to configure it. If $ARGUMENTS already says which, apply it ' +
      'directly with action="apply".',
  },
  {
    name: 'foundry-board',
    description: 'Show the Kanban board',
    template:
      'Call foundry_board with view="markdown" and show it. Then say in one line what is blocking progress.',
  },
  {
    name: 'foundry-status',
    description: 'Project status: progress, running, blocked, cost',
    template:
      'Call foundry_board with view="summary" and foundry_doctor. Summarise objective, phase, ' +
      'progress, what is running or blocked, any unanswered question, and cost. Flag every doctor ' +
      'error. Keep it under 15 lines.',
  },
  {
    name: 'foundry-next',
    description: 'Execute everything that is ready',
    template:
      'Call foundry_execute. For each result, record it with foundry_complete (with the evidence it ' +
      'reported) or foundry_fail, then run the review gates. Report the board delta when done.',
  },
  {
    name: 'foundry-graph',
    description: 'Inspect dependencies, blast radius and the critical path',
    template:
      'Call foundry_graph for $ARGUMENTS (use action="validate" and "critical_path" when no task id ' +
      'is given) and explain the dependencies, the critical path, and what a change would affect.',
  },
  {
    name: 'foundry-ui',
    description: 'Open the Agent Foundry desktop window',
    template:
      'Call foundry_ui and report the result. If the binary has not been built, tell me the exact ' +
      'commands to build it and confirm everything else keeps working without it.',
  },
  {
    name: 'foundry-help',
    description: 'What the Agent Foundry is and how to drive it',
    template:
      'Explain the Agent Foundry without calling tools: one entry point (the orchestrator, running ' +
      'on the model selected in this chat) coordinating architect, lead, analyst and builder. One ' +
      'flow: it configures the session, asks what it needs, plans onto a Kanban board, dispatches ' +
      'the work itself, keeps you posted and reports at the end. Commands: /foundry /foundry-setup ' +
      '/foundry-board /foundry-status /foundry-next /foundry-graph /foundry-ui /foundry-help. Keep it short.',
  },
];

export const AgentFoundryPlugin: Plugin = async (input) => {
  const directory = input.directory;

  let config = defaultConfig();
  try {
    config = loadConfig(directory).config;
  } catch {
    // A broken config file must never stop the plugin from loading.
  }

  const agents: Record<string, unknown> = {};
  for (const def of createAgentDefs(config)) {
    agents[def.name] = toOpenCodeAgent(def);
  }

  // The host is how the plugin reaches OpenCode itself: the model catalogue,
  // the model this chat is on, and running a role. Falling back to the offline
  // host keeps the plugin usable when the client is unavailable.
  const host = input.client ? createOpencodeHost(input.client) : OFFLINE_HOST;
  const gate = new SessionGate();
  // One object, shared by the chat tools and the window, so "open the setup
  // screen" asked for in a conversation is the same request the window answers.
  const setupRequest = new SetupRequest();

  const desktop = new DesktopLifecycle(directory, config, host, setupRequest);
  if (config.desktop.enabled && config.desktop.autostart) {
    // Fire and forget: a bridge that fails to bind must not block startup.
    void desktop.ensureBridge().catch(() => undefined);
  }

  let tools: Record<string, unknown> = {};
  try {
    tools = createFoundryTools({
      fallbackDir: directory,
      host,
      gate,
      setupRequest,
      notify: () => desktop.notify(['board', 'project', 'graph', 'events']),
      openDesktop: async () => {
        const result = await desktop.open();
        return {
          status: result.status,
          ...(result.url ? { url: result.url } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
        };
      },
    }) as unknown as Record<string, unknown>;
  } catch {
    tools = {};
  }

  return {
    tool: tools,

    /**
     * Agents and commands are registered here, not returned directly: the
     * plugin Hooks interface has no `agent` key. Existing user definitions win,
     * so a project can override anything this plugin contributes.
     */
    config: async (opencodeConfig: Record<string, unknown>) => {
      const cfg = opencodeConfig as {
        agent?: Record<string, unknown>;
        command?: Record<string, unknown>;
      };
      cfg.agent ??= {};
      for (const [name, definition] of Object.entries(agents)) {
        if (!(name in cfg.agent)) cfg.agent[name] = definition;
      }
      cfg.command ??= {};
      for (const command of COMMANDS) {
        if (!(command.name in cfg.command)) {
          cfg.command[command.name] = { template: command.template, description: command.description };
        }
      }
    },

    /**
     * State changes happen only through explicit foundry_* tool calls, so this
     * hook does no work beyond nudging any open desktop window to refresh.
     * Mutating state per event would invalidate the prompt cache and cause
     * writes the user never asked for.
     */
    event: async ({ event }: { event: { type: string } }) => {
      if (event.type.startsWith('tool.')) desktop.notify(['board', 'project', 'events']);
    },

    dispose: async () => {
      await desktop.dispose();
    },
  } as unknown as Awaited<ReturnType<Plugin>>;
};

export default {
  id: 'opencode-agent-foundry',
  server: AgentFoundryPlugin,
};

export { createFoundryTools } from './tools/definitions.js';
export { createEngine } from './tools/engine.js';
export { COMMANDS };
