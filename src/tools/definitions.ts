import { tool } from '@opencode-ai/plugin';
import { createEngine, type Engine } from './engine.js';
import { renderBoardMarkdown } from '../core/board.js';
import { CONFIGURABLE_ROLES, type ConfigurableRole } from '../config/schema.js';
import type { Host } from '../runtime/host.js';
import type { SessionGate, SetupRequest } from '../runtime/setup.js';

const z = tool.schema;

/**
 * Tool surface.
 *
 * Three constraints shape every line here:
 *
 * - Every name, description and argument schema below is re-sent to the model
 *   on EVERY turn. That is a fixed cost paid before the user has typed a word,
 *   so descriptions say what to do next in as few words as will do the job.
 * - Results are compact JSON, never pretty-printed, and never a whole task
 *   document unless asked for.
 * - The project directory comes from the tool context, not from plugin load
 *   time, so one OpenCode instance serving several projects stays correct.
 */

type ToolMap = Record<string, ReturnType<typeof tool>>;

interface Ctx {
  sessionID: string;
  directory: string;
  abort: AbortSignal;
}

function reply(value: unknown): string {
  return JSON.stringify(value);
}

function fail(error: unknown): string {
  return reply({ error: error instanceof Error ? error.message : String(error) });
}

export interface ToolDeps {
  /** Used when a caller gives no directory (CLI, tests). */
  fallbackDir: string;
  host: Host;
  gate: SessionGate;
  /** Opens or focuses the desktop window. Absent in headless builds. */
  openDesktop?: () => Promise<{ status: string; url?: string; detail?: string }>;
  /** Shared with the desktop so `choice="configure"` reaches the window. */
  setupRequest?: SetupRequest;
  /** Notifies open desktop windows that state changed. */
  notify?: () => void;
}

const PROPOSAL = {
  title: z.string(),
  objective: z.string().describe('What must be true when this is done'),
  module: z.string().optional(),
  functionality: z.string().optional(),
  allowed_files: z.array(z.string()).optional().describe('The ONLY paths the builder may touch'),
  acceptance_criteria: z.array(z.string()).optional(),
  verification: z.string().optional().describe('Command that proves it works'),
  depends_on: z.array(z.string()).optional().describe('Task ids, or "ref" handles from this plan'),
  ref: z.string().optional().describe('Handle so later proposals can depend on this one'),
  priority: z.number().optional().describe('1 low to 9 high, default 5'),
  owner: z.string().optional(),
};

export function createFoundryTools(deps: ToolDeps): ToolMap {
  const engineFor = (ctx?: Partial<Ctx>): Engine =>
    createEngine(ctx?.directory || deps.fallbackDir, {
      host: deps.host,
      ...(deps.setupRequest ? { setupRequest: deps.setupRequest } : {}),
    });

  /** Runs a synchronous engine call, reporting errors as data. */
  const run = (ctx: Ctx | undefined, work: (engine: Engine) => unknown): string => {
    try {
      const out = reply(work(engineFor(ctx)));
      deps.notify?.();
      return out;
    } catch (error) {
      return fail(error);
    }
  };

  const runAsync = async (ctx: Ctx | undefined, work: (engine: Engine) => Promise<unknown>): Promise<string> => {
    try {
      const out = reply(await work(engineFor(ctx)));
      deps.notify?.();
      return out;
    } catch (error) {
      return fail(error);
    }
  };

  const tools: ToolMap = {
    // ---- configuration -----------------------------------------------------

    foundry_setup: tool({
      description:
        'Session setup — call this first in a new conversation. action="status" reports what is in ' +
        'effect and whether to ask; action="apply" records the answer. choice="keep" leaves ' +
        'everything as it is; choice="configure" opens the desktop console on its setup screen.',
      args: {
        action: z.enum(['status', 'apply']),
        choice: z.enum(['keep', 'configure', 'preset', 'inherit', 'custom']).optional(),
        preset: z.string().optional().describe('Preset id, only with choice="preset"'),
        architect: z.string().optional().describe('Model id, or "" to use the chat model'),
        lead: z.string().optional(),
        analyst: z.string().optional(),
        builder: z.string().optional(),
        builders: z.number().optional().describe('Concurrent builders. 0 = unlimited'),
      },
      async execute(args, ctx) {
        return runAsync(ctx as Ctx, async (engine) => {
          const c = ctx as Ctx;

          if (args.action === 'status') {
            const view = await engine.runtime();
            // The gate opens once per conversation. A project configured last
            // week still gets asked — "keep" is one of the two answers, not a
            // reason to skip the question.
            const greet = deps.gate.claim(c.sessionID);
            const summary = view.active_preset
              ? `the ${view.active_preset} preset`
              : view.models
                  .filter((m) => m.configurable && m.model)
                  .map((m) => `${m.role}: ${m.model}`)
                  .join(', ') || 'every role on the chat model';
            return {
              configured: view.configured,
              in_effect: summary,
              builders: view.builders,
              ask_now: greet,
              ...(greet
                ? {
                    options: {
                      keep: `Keep the current setup (${summary}, ${
                        view.builders === 0 ? 'unlimited' : view.builders
                      } builders)`,
                      configure: 'Open the Agent Foundry desktop console to choose models and builders',
                    },
                    next:
                      'Put exactly these two options to the human, in their language, showing what ' +
                      'is in effect. Wait for the answer, then apply it. Offer nothing else — every ' +
                      'model choice happens on the window, which can show them.',
                  }
                : { next: 'Setup was already offered in this conversation. Carry on.' }),
            };
          }

          const choice = args.choice ?? 'keep';

          if (choice === 'configure') {
            // Raised before the window opens, so a window that is already up
            // switches to the setup screen on its next read rather than
            // ignoring a request it never saw.
            engine.requestSetup();
            const opened = deps.openDesktop ? await deps.openDesktop().catch(() => null) : null;
            if (opened && opened.status === 'opened') {
              return {
                opened: true,
                ...(opened.url ? { url: opened.url } : {}),
                next:
                  'The window is open on its setup screen. Tell the human to choose there, and wait ' +
                  'for them to say they are done before doing anything else.',
              };
            }
            // No window: the choice still has to be makeable, so fall back to
            // offering the same presets in chat rather than dead-ending.
            const view = await engine.runtime();
            return {
              opened: false,
              reason: opened?.detail ?? opened?.status ?? 'the desktop console is unavailable',
              presets: view.presets.map((preset) => ({
                id: preset.id,
                label: preset.label,
                summary: preset.summary,
                available: preset.available,
              })),
              next:
                'The window could not open. Offer these presets in chat instead — or "inherit" to ' +
                'run every role on the chat model — then apply with choice="preset" and its id.',
            };
          }

          const models: Partial<Record<ConfigurableRole, string>> = {};
          for (const role of CONFIGURABLE_ROLES) {
            const value = args[role as 'architect' | 'lead' | 'analyst' | 'builder'];
            if (typeof value === 'string') models[role] = value;
          }
          return engine.setup({
            choice,
            ...(args.preset ? { preset: args.preset } : {}),
            ...(Object.keys(models).length ? { models } : {}),
            ...(typeof args.builders === 'number' ? { builders: args.builders } : {}),
          });
        });
      },
    }),

    // ---- understanding the objective ---------------------------------------

    foundry_start: tool({
      description: 'Create the board for an objective.',
      args: { objective: z.string().describe("The human's goal, in their words") },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.start(args.objective));
      },
    }),

    foundry_ask: tool({
      description:
        'Record what you need answered before planning. Ask only about real ambiguity, destructive operations, contract changes, external dependencies or conflicting requirements — never to tick a box.',
      args: {
        questions: z.array(z.object({ question: z.string(), why: z.string().describe('Why the answer changes the work') })),
      },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.ask(args.questions));
      },
    }),

    foundry_answer: tool({
      description: "Record the human's replies. They become binding decisions.",
      args: { answers: z.array(z.object({ id: z.string(), answer: z.string() })) },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.answer(args.answers));
      },
    }),

    // ---- planning ----------------------------------------------------------

    foundry_consult: tool({
      description:
        'Ask a reasoning role a question and get its answer back. The plugin builds the context packet and runs the role on its configured model — you do not relay anything. Use for architecture, decomposition or review judgement.',
      args: {
        role: z.enum(['architect', 'lead', 'analyst']),
        brief: z.string().describe('What you need decided, in one or two sentences'),
        task: z.string().optional().describe('Task id to focus on'),
      },
      async execute(args, ctx) {
        const c = ctx as Ctx;
        return runAsync(c, (engine) =>
          engine.delegateRole({
            role: args.role,
            sessionID: c.sessionID,
            directory: c.directory || deps.fallbackDir,
            brief: args.brief,
            ...(args.task ? { taskId: args.task } : {}),
            signal: c.abort,
          }),
        );
      },
    }),

    foundry_plan: tool({
      description:
        'Record a plan from a reasoning role. Planning only — creates no tasks. Give each author a distinct scope so proposals do not overlap.',
      args: {
        author: z.enum(['architect', 'lead', 'analyst']),
        scope: z.string(),
        summary: z.string(),
        proposals: z.array(z.object(PROPOSAL)),
        risks: z.array(z.string()).optional(),
        open_questions: z.array(z.string()).optional(),
      },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) =>
          engine.planSubmit({
            author: args.author,
            scope: args.scope,
            summary: args.summary,
            proposals: args.proposals,
            ...(args.risks ? { risks: args.risks } : {}),
            ...(args.open_questions ? { open_questions: args.open_questions } : {}),
          }),
        );
      },
    }),

    foundry_apply_plan: tool({
      description: 'Turn a plan into board tasks in one call, resolving dependencies between them.',
      args: { plan: z.string(), prefix: z.string().optional() },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.planApply(args.plan, args.prefix));
      },
    }),

    // ---- execution ---------------------------------------------------------

    foundry_execute: tool({
      description:
        'Run every ready task in parallel, up to the configured builder count. The plugin dispatches each builder with its own packet and returns their results. Prefer this over driving tasks one at a time.',
      args: {},
      async execute(_args, ctx) {
        const c = ctx as Ctx;
        return runAsync(c, (engine) =>
          engine.executeReady({
            sessionID: c.sessionID,
            directory: c.directory || deps.fallbackDir,
            signal: c.abort,
          }),
        );
      },
    }),

    foundry_next: tool({
      description: 'Ask the scheduler what may start now, without running anything. Respects dependencies, builder count and file locks.',
      args: {},
      async execute(_args, ctx) {
        return run(ctx as Ctx, (engine) => engine.next());
      },
    }),

    foundry_complete: tool({
      description:
        'Record a finished task WITH evidence. Rejected unless files changed and tests actually ran and passed. Moves the task to REVIEW or FAILED.',
      args: {
        id: z.string(),
        actor: z.string().optional(),
        files_created: z.array(z.string()).optional(),
        files_modified: z.array(z.string()).optional(),
        files_deleted: z.array(z.string()).optional(),
        commands_executed: z.array(z.string()).optional(),
        tests_executed: z.array(z.string()).optional().describe('Test commands that actually ran'),
        test_result: z.enum(['pass', 'fail', 'unknown']).optional(),
        output_summary: z.string().optional(),
      },
      async execute(args, ctx) {
        const { id, actor, ...evidence } = args;
        return run(ctx as Ctx, (engine) => engine.taskComplete(id, evidence, actor));
      },
    }),

    foundry_fail: tool({
      description: 'Record a failed attempt. Returns whether to retry, escalate or block.',
      args: { id: z.string(), error_summary: z.string(), actor: z.string().optional() },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.taskFail(args.id, args.error_summary, args.actor));
      },
    }),

    foundry_review: tool({
      description: 'Decide one review gate. Rejecting returns the task to IN_PROGRESS; passing the last gate marks it DONE and unblocks dependents.',
      args: {
        id: z.string(),
        gate: z.enum(['execution', 'test', 'review', 'architecture', 'acceptance']),
        decision: z.enum(['passed', 'rejected']),
        reviewer: z.string(),
        note: z.string().optional(),
      },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.review(args.id, args.gate, args.decision, args.reviewer, args.note));
      },
    }),

    foundry_escalate: tool({
      description: 'Escalate builder to analyst to lead to architect with a recorded reason, instead of retrying a failing approach.',
      args: { id: z.string(), from: z.string(), reason: z.string() },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.escalate(args.id, args.from, args.reason));
      },
    }),

    // ---- reading state -----------------------------------------------------

    foundry_board: tool({
      description:
        'The board and the project. view="summary" for objective, phase, progress, cost and what is blocked; view="board" for every task by column; view="markdown" for a compact human-readable board.',
      args: { view: z.enum(['summary', 'board', 'markdown']).optional() },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => {
          if (args.view === 'board') return engine.board();
          if (args.view === 'markdown') return { markdown: renderBoardMarkdown(engine.board()) };
          return engine.status();
        });
      },
    }),

    foundry_task: tool({
      description:
        'One task. Pass fields to change it — refused if it would rewrite an anchored value or move a task to READY with unmet dependencies. detail=true also returns attempt history and evidence, which is large.',
      args: {
        id: z.string(),
        detail: z.boolean().optional(),
        status: z
          .enum(['BACKLOG', 'PLANNED', 'READY', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'FAILED', 'DONE', 'CANCELLED'])
          .optional(),
        priority: z.number().optional(),
        blocked_reason: z.string().optional(),
        owner: z.string().optional(),
        acceptance_criteria: z.array(z.string()).optional(),
        depends_on: z.array(z.string()).optional(),
        anchors: z.array(z.string()).optional(),
      },
      async execute(args, ctx) {
        const { id, detail, ...patch } = args;
        const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        return run(ctx as Ctx, (engine) =>
          Object.keys(changes).length ? engine.taskUpdate(id, changes) : engine.taskShow(id, detail),
        );
      },
    }),

    foundry_tasks: tool({
      description: 'List task summaries, optionally filtered by status or module.',
      args: { status: z.string().optional(), module: z.string().optional(), limit: z.number().optional() },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.taskList(args));
      },
    }),

    foundry_graph: tool({
      description: 'Query the work graph: show | upstream | downstream | impact | critical_path | validate.',
      args: {
        action: z.enum(['show', 'upstream', 'downstream', 'impact', 'critical_path', 'validate']),
        id: z.string().optional(),
      },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.graph(args.action, args.id));
      },
    }),

    foundry_doctor: tool({
      description:
        'Consistency check: cycles, missing dependencies, tasks without acceptance criteria, file overlaps that will serialise execution, plans never applied, stalled work.',
      args: {},
      async execute(_args, ctx) {
        return run(ctx as Ctx, (engine) => engine.doctor());
      },
    }),

    foundry_events: tool({
      description: 'Recent audit-log entries, for explaining what happened and when.',
      args: { limit: z.number().optional() },
      async execute(args, ctx) {
        return run(ctx as Ctx, (engine) => engine.events(args.limit ?? 30));
      },
    }),
  };

  if (deps.openDesktop) {
    tools['foundry_ui'] = tool({
      description: 'Open the Agent Foundry desktop console — a native window, not a browser tab. Reuses the existing one.',
      args: {},
      async execute() {
        try {
          return reply(await deps.openDesktop!());
        } catch (error) {
          return fail(error);
        }
      },
    });
  }

  return tools;
}
