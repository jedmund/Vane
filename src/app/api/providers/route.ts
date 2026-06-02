import ModelRegistry from '@/lib/models/registry';
import { NextRequest } from 'next/server';
import {
  AdminRequiredError,
  adminRequiredResponse,
  getCurrentUserId,
  MissingUserIdHeaderError,
  missingUserIdResponse,
  requireAdmin,
} from '@/lib/db/scoped';
import { createProvider } from '@/lib/db/providers';
import { providers as providerClasses } from '@/lib/models/providers';

export const GET = async (req: Request) => {
  try {
    const userId = getCurrentUserId(req);
    const registry = new ModelRegistry(userId);

    // getActiveProviders already shapes the response without api_key or
    // base_url; the registry only surfaces id/name/type/scope/chatModels/
    // embeddingModels. The raw config blob stays inside the registry's
    // private activeProviders array and never crosses this boundary.
    const activeProviders = await registry.getActiveProviders();

    const filteredProviders = activeProviders.filter((p) => {
      return !p.chatModels.some((m) => m.key === 'error');
    });

    return Response.json(
      {
        providers: filteredProviders,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while fetching providers', err);
    return Response.json(
      {
        message: 'An error has occurred.',
      },
      {
        status: 500,
      },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const userId = getCurrentUserId(req);
    const body = await req.json();
    const { type, name, config, scope: rawScope } = body;

    if (!type || !name || !config) {
      return Response.json(
        {
          message: 'Missing required fields.',
        },
        {
          status: 400,
        },
      );
    }

    // Unknown provider types should not get a row written. The /models
    // endpoints would later fail to resolve them and the row would sit
    // permanently broken.
    if (!providerClasses[type]) {
      return Response.json(
        {
          message: `Unknown provider type: ${type}`,
        },
        {
          status: 400,
        },
      );
    }

    const scope: 'instance' | 'personal' =
      rawScope === 'instance' ? 'instance' : 'personal';

    if (scope === 'instance') {
      // requireAdmin re-resolves the userId from headers, which is fine:
      // the second call is cheap and keeps the admin gate identical to
      // every other admin-only mutation in the codebase.
      try {
        await requireAdmin(req);
      } catch (err) {
        if (err instanceof AdminRequiredError) return adminRequiredResponse();
        throw err;
      }
    }

    const created = createProvider({
      userId: scope === 'instance' ? null : userId,
      type,
      name,
      config,
    });

    // Auto-sync remote models on creation. Instantiate the provider class,
    // call getDefaultModels(), and write the result back to the row so the
    // provider is immediately usable without a manual "Add Model" step.
    try {
      const Provider = providerClasses[type];
      const parsed = Provider.parseAndValidate(config);
      const instance = new Provider(created.id, name, parsed);
      const modelList = await instance.getDefaultModels();
      const { updateProviderRow } = await import('@/lib/db/providers');
      updateProviderRow(created.id, {
        chatModels: modelList.chat,
        embeddingModels: modelList.embedding,
      });
      created.chatModels = modelList.chat;
      created.embeddingModels = modelList.embedding;
    } catch (err) {
      console.warn(
        `Auto-sync models failed for provider ${created.id} (${type}):`,
        err,
      );
    }

    return Response.json(
      {
        provider: {
          id: created.id,
          name: created.name,
          type: created.type,
          scope,
          chatModels: created.chatModels,
          embeddingModels: created.embeddingModels,
        },
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while creating provider', err);
    return Response.json(
      {
        message: 'An error has occurred.',
      },
      {
        status: 500,
      },
    );
  }
};
