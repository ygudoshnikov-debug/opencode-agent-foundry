#!/usr/bin/env node
/**
 * agentfoundry — CLI over the same `.agent-foundry/` state the plugin uses.
 *
 * Exists so no capability is trapped behind a UI: everything the desktop window
 * shows can be read here, and the state lives in files either way.
 *
 *   agentfoundry status  [--dir .] [--json]
 *   agentfoundry board   [--dir .] [--json]
 *   agentfoundry tree    [--dir .]
 *   agentfoundry tasks   [--dir .] [--status S] [--module M]
 *   agentfoundry task <ID> [--dir .] [--detail]
 *   agentfoundry graph   [--dir .] [--focus ID] [--mode show|upstream|downstream|impact|critical|validate]
 *   agentfoundry next    [--dir .]
 *   agentfoundry doctor  [--dir .]
 *   agentfoundry events  [--dir .] [--limit N]
 *   agentfoundry models  [--dir .] [--set ROLE=MODEL]
 *   agentfoundry init "<objective>" [--dir .]
 */
import { createEngine } from '../tools/engine.js';
import { FoundryStore } from '../core/store.js';
import { CONFIGURABLE_ROLES, type ConfigurableRole } from '../config/schema.js';
import {
  renderBoardMarkdown,
  renderDoctorMarkdown,
  renderGraphAscii,
  renderStatusMarkdown,
  renderTree,
} from '../views/render.js';
import type { DoctorReport, GraphView, ProjectSummary } from '../desktop/protocol.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function out(value: unknown): void {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const dir = arg('--dir') ?? process.cwd();
const command = process.argv[2] ?? 'status';
const engine = createEngine(dir);
const store = new FoundryStore(dir);

function requireInit(): void {
  if (!store.exists()) {
    fail(`Agent Foundry is not initialised in ${dir}.\nRun: agentfoundry init "<objective>"`);
  }
}

function main(): void {
  switch (command) {
    case 'init': {
      const objective = process.argv[3];
      if (!objective) fail('Usage: agentfoundry init "<objective>"');
      out(engine.start(objective));
      return;
    }

    case 'status': {
      const status = engine.status() as ProjectSummary;
      out(flag('--json') ? status : renderStatusMarkdown(status));
      return;
    }

    case 'board': {
      requireInit();
      const board = engine.board();
      out(flag('--json') ? board : renderBoardMarkdown(board, store.loadProject()?.objective));
      return;
    }

    case 'tree': {
      requireInit();
      out(renderTree(store.loadAllTasks()));
      return;
    }

    case 'tasks': {
      requireInit();
      out(
        engine.taskList({
          ...(arg('--status') ? { status: arg('--status')! } : {}),
          ...(arg('--module') ? { module: arg('--module')! } : {}),
        }),
      );
      return;
    }

    case 'task': {
      requireInit();
      const id = process.argv[3];
      if (!id) fail('Usage: agentfoundry task <ID> [--detail]');
      out(engine.taskShow(id, flag('--detail')));
      return;
    }

    case 'graph': {
      requireInit();
      const modes: Record<string, 'show' | 'upstream' | 'downstream' | 'impact' | 'critical_path' | 'validate'> = {
        show: 'show',
        upstream: 'upstream',
        downstream: 'downstream',
        impact: 'impact',
        critical: 'critical_path',
        validate: 'validate',
      };
      const mode = modes[arg('--mode') ?? 'show'] ?? 'show';
      const focus = arg('--focus');
      if (mode === 'show' && !flag('--json')) {
        const view = engine.graphView() as GraphView;
        out(renderGraphAscii(view.edges, focus));
        return;
      }
      out(engine.graph(mode, focus));
      return;
    }

    case 'next': {
      requireInit();
      out(engine.next());
      return;
    }

    case 'doctor': {
      requireInit();
      const report = engine.doctor() as DoctorReport;
      out(flag('--json') ? report : renderDoctorMarkdown(report));
      if (!report.ok) process.exitCode = 1;
      return;
    }

    case 'events': {
      requireInit();
      out(engine.events(Number(arg('--limit') ?? 30)));
      return;
    }

    case 'models': {
      const set = arg('--set');
      if (set) {
        const [role, ...rest] = set.split('=');
        const model = rest.join('=');
        if (!role || !CONFIGURABLE_ROLES.includes(role as ConfigurableRole)) {
          fail(`--set expects ROLE=MODEL where ROLE is one of: ${CONFIGURABLE_ROLES.join(', ')}`);
        }
        out(engine.setModel(role as ConfigurableRole, model));
        return;
      }
      out(engine.configView());
      return;
    }

    default:
      fail(
        `Unknown command: ${command}\n` +
          'Commands: init status board tree tasks task graph next doctor events models',
      );
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
