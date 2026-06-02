import { ConfigModelProvider } from '../config/types';
import BaseModelProvider, { createProviderInstance } from './base/provider';
import { getProvidersForUser, StoredProvider } from '../db/providers';
import { providers } from './providers';
import { MinimalProvider, ModelList } from './types';

// Registry is per-request because provider visibility is per-user (instance
// rows visible to everyone, personal rows only to their owner). The userId
// is required and never optional: silently expanding scope to "all
// providers" would defeat the whole point of the admin/user split.
class ModelRegistry {
  activeProviders: (ConfigModelProvider & {
    provider: BaseModelProvider<any>;
  })[] = [];

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

  // Mutation paths are stubs in Phase 3. Provider writes used to flow
  // through configManager and end up in config.json; the providers table
  // is the source of truth now and Phase 4 owns the rewrite of the
  // /api/providers route handlers to insert/update/delete rows directly.
  // These throw so a regression surfaces loudly rather than silently
  // dropping the write.
  async addProvider(
    _type: string,
    _name: string,
    _config: Record<string, any>,
  ): Promise<ConfigModelProvider> {
    throw new Error(
      'ModelRegistry.addProvider is a Phase 3 stub; Phase 4 will write directly to the providers table.',
    );
  }

  async removeProvider(_providerId: string): Promise<void> {
    throw new Error(
      'ModelRegistry.removeProvider is a Phase 3 stub; Phase 4 will write directly to the providers table.',
    );
  }

  async updateProvider(
    _providerId: string,
    _name: string,
    _config: any,
  ): Promise<ConfigModelProvider> {
    throw new Error(
      'ModelRegistry.updateProvider is a Phase 3 stub; Phase 4 will write directly to the providers table.',
    );
  }

  async addProviderModel(
    _providerId: string,
    _type: 'embedding' | 'chat',
    _model: any,
  ): Promise<any> {
    throw new Error(
      'ModelRegistry.addProviderModel is a Phase 3 stub; Phase 4 will write directly to the providers table.',
    );
  }

  async removeProviderModel(
    _providerId: string,
    _type: 'embedding' | 'chat',
    _modelKey: string,
  ): Promise<void> {
    throw new Error(
      'ModelRegistry.removeProviderModel is a Phase 3 stub; Phase 4 will write directly to the providers table.',
    );
  }
}

export default ModelRegistry;
