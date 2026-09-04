import { formatModel, parseModel, type DispatchRequest, type DispatchResult, type Host } from './host.js';
import type { ModelOption } from '../desktop/protocol.js';

/**
 * Host backed by the OpenCode SDK client handed to the plugin.
 *
 * This is what makes delegation deterministic. Instead of the orchestrator
 * writing "@builder" into a chat message and re-typing the context packet —
 * paying for it twice and hoping it survives paraphrasing — the plugin creates
 * a child session and prompts it directly with the exact packet, the model
 * resolved from configuration AT THIS MOMENT, and a restricted tool set.
 *
 * Resolving the model here rather than at agent-registration time is what makes
 * a configuration change take effect immediately: OpenCode 1.18.x registers
 * agents once and offers no way to re-register them, so a model baked into an
 * agent definition would be frozen until restart.
 */

/** Shape of the SDK surface we depend on. Narrow on purpose. */
interface OpencodeClient {
  config: {
    providers(): Promise<{ data?: { providers?: RawProvider[] } } | undefined>;
  };
  session: {
    get(options: { path: { id: string } }): Promise<{ data?: RawSession } | undefined>;
    create(options: {
      body?: { parentID?: string; title?: string };
      query?: { directory?: string };
    }): Promise<{ data?: { id?: string } } | undefined>;
    prompt(options: {
      path: { id: string };
      query?: { directory?: string };
      body: {
        model?: { providerID: string; modelID: string };
        agent?: string;
        system?: string;
        tools?: Record<string, boolean>;
        parts: Array<{ type: 'text'; text: string }>;
      };
    }): Promise<{ data?: { parts?: RawPart[] } } | undefined>;
  };
}

interface RawProvider {
  id?: string;
  name?: string;
  models?: Record<string, { id?: string; name?: string } | undefined>;
}

interface RawSession {
  model?: { providerID?: string; id?: string; modelID?: string };
}

interface RawPart {
  type?: string;
  text?: string;
}

export function createOpencodeHost(client: unknown): Host {
  const sdk = client as OpencodeClient;

  const safe = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await operation();
    } catch {
      // The host being unreachable must degrade, never crash a tool call.
      return fallback;
    }
  };

  return {
    async catalogue(): Promise<ModelOption[]> {
      return safe(async () => {
        const response = await sdk.config.providers();
        const providers = response?.data?.providers ?? [];
        const options: ModelOption[] = [];
        for (const provider of providers) {
          const providerID = provider.id;
          if (!providerID) continue;
          for (const [key, model] of Object.entries(provider.models ?? {})) {
            const modelID = model?.id ?? key;
            if (!modelID) continue;
            options.push({
              id: formatModel(providerID, modelID),
              providerID,
              modelID,
              name: model?.name ?? modelID,
              provider: provider.name ?? providerID,
            });
          }
        }
        return options.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
      }, []);
    },

    async sessionModel(sessionID: string): Promise<string | null> {
      return safe(async () => {
        const response = await sdk.session.get({ path: { id: sessionID } });
        const model = response?.data?.model;
        const providerID = model?.providerID;
        const modelID = model?.modelID ?? model?.id;
        if (!providerID || !modelID) return null;
        return formatModel(providerID, modelID);
      }, null);
    },

    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      // An empty binding means "run this role on whatever the conversation is
      // using", which is only knowable at dispatch time.
      let modelID = request.model.trim();
      if (!modelID) modelID = (await this.sessionModel(request.parentSessionID)) ?? '';
      const parsed = modelID ? parseModel(modelID) : null;

      try {
        if (request.signal?.aborted) {
          return { ok: false, text: '', error: 'cancelled before dispatch' };
        }

        const created = await sdk.session.create({
          body: { parentID: request.parentSessionID, title: request.title },
          query: { directory: request.directory },
        });
        const sessionID = created?.data?.id;
        if (!sessionID) {
          return { ok: false, text: '', error: 'OpenCode did not return a child session' };
        }

        const answer = await sdk.session.prompt({
          path: { id: sessionID },
          query: { directory: request.directory },
          body: {
            ...(parsed ? { model: parsed } : {}),
            agent: request.role,
            ...(request.tools ? { tools: request.tools } : {}),
            parts: [{ type: 'text', text: request.prompt }],
          },
        });

        const text = (answer?.data?.parts ?? [])
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text as string)
          .join('\n')
          .trim();

        if (!text) {
          return {
            ok: false,
            text: '',
            sessionID,
            ...(modelID ? { model: modelID } : {}),
            error: `${request.role} returned no text`,
          };
        }
        return { ok: true, text, sessionID, ...(modelID ? { model: modelID } : {}) };
      } catch (error) {
        return {
          ok: false,
          text: '',
          ...(modelID ? { model: modelID } : {}),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
