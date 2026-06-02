import { ConfigModelProvider } from '../config/types';
import BaseModelProvider, { createProviderInstance } from './base/provider';
import { getProvidersForUser, StoredProvider } from '../db/providers';
import { providers } from './providers';
import { MinimalProvider, ModelList } from './types';

// Internal extension of ConfigModelProvider so the registry can carry the
// scope (instance vs personal) through to the serializer without losing it
// to the toConfigShape conversion.
type ActiveProvider = ConfigModelProvider & {
  scope: 'instance' | 'personal';
  provider: BaseModelProvider<any>;
};

// Registry is per-request because provider visibility is per-user (instance
// rows visible to everyone, personal rows only to their owner). The userId
// is required and never optional: silently expanding scope to "all
// providers" would defeat the whole point of the admin/user split.
class ModelRegistry {
  activeProviders: ActiveProvider[] = [];

  constructor(private userId: string) {
    this.initializeActiveProviders();
  }

  private initializeActiveProviders() {
    const rows = getProvidersForUser(this.userId);

    rows.forEach((row) => {
      try {
        const Provider = providers[row.type];
        if (!Provider) throw new Error('Invalid provider type');

        this.activeProviders.push({
          ...this.toConfigShape(row),
          scope: row.userId === null ? 'instance' : 'personal',
          provider: createProviderInstance(
            Provider,
            row.id,
            row.name,
            row.config,
            row.chatModels,
            row.embeddingModels,
          ),
        });
      } catch (err) {
        console.error(
          `Failed to initialize provider. Type: ${row.type}, ID: ${row.id}, Error: ${err}`,
        );
      }
    });
  }

  // Phase 3 keeps the existing in-memory shape (ConfigModelProvider) so
  // downstream consumers do not need to change. The hash field is left
  // empty: it was previously used by configManager to dedupe env-derived
  // providers against on-disk providers, and that dedup path is gone.
  private toConfigShape(row: StoredProvider): ConfigModelProvider {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      config: row.config,
      chatModels: row.chatModels,
      embeddingModels: row.embeddingModels,
      hash: '',
    };
  }

  async getActiveProviders() {
    const providers: MinimalProvider[] = [];

    await Promise.all(
      this.activeProviders.map(async (p) => {
        let m: ModelList = { chat: [], embedding: [] };

        try {
          m = await p.provider.getModelList();
        } catch (err: any) {
          console.error(
            `Failed to get model list. Type: ${p.type}, ID: ${p.id}, Error: ${err.message}`,
          );

          m = {
            chat: [
              {
                key: 'error',
                name: err.message,
              },
            ],
            embedding: [],
          };
        }

        providers.push({
          id: p.id,
          name: p.name,
          type: p.type,
          scope: p.scope,
          chatModels: m.chat,
          embeddingModels: m.embedding,
        });
      }),
    );

    return providers;
  }

  async loadChatModel(providerId: string, modelName: string) {
    const provider = this.activeProviders.find((p) => p.id === providerId);

    if (!provider) throw new Error('Invalid provider id');

    const model = await provider.provider.loadChatModel(modelName);

    return model;
  }

  async loadEmbeddingModel(providerId: string, modelName: string) {
    const provider = this.activeProviders.find((p) => p.id === providerId);

    if (!provider) throw new Error('Invalid provider id');

    const model = await provider.provider.loadEmbeddingModel(modelName);

    return model;
  }

  // Mutation paths intentionally removed. Provider writes happen in the
  // /api/providers route handlers via the helpers in src/lib/db/providers.ts;
  // adding back any mutation method here would re-create the pre-Phase 1
  // pattern of routing writes through the registry, which made access control
  // diffuse and easy to bypass.
}

export default ModelRegistry;
