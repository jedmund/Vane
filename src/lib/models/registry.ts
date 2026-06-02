import { ConfigModelProvider } from '../config/types';
import BaseModelProvider, { createProviderInstance } from './base/provider';
import { getProvidersForUser, StoredProvider } from '../db/providers';
import { providers } from './providers';
import { MinimalProvider, ModelList } from './types';
import configManager from '../config';

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

  // The mutation paths below still write through configManager, which has
  // been gutted in the Phase 3 cleanup commit to be a no-op (the config.json
  // modelProviders key is gone). Phase 4 owns the rewrite of the route
  // handlers that call these methods; until then the calls will fail at
  // runtime, which is the intended forcing function for the Phase 4 work.
  async addProvider(
    type: string,
    name: string,
    config: Record<string, any>,
  ): Promise<ConfigModelProvider> {
    const provider = providers[type];
    if (!provider) throw new Error('Invalid provider type');

    const newProvider = configManager.addModelProvider(type, name, config);

    const instance = createProviderInstance(
      provider,
      newProvider.id,
      newProvider.name,
      newProvider.config,
      newProvider.chatModels,
      newProvider.embeddingModels,
    );

    let m: ModelList = { chat: [], embedding: [] };

    try {
      m = await instance.getModelList();
    } catch (err: any) {
      console.error(
        `Failed to get model list for newly added provider. Type: ${type}, ID: ${newProvider.id}, Error: ${err.message}`,
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

    this.activeProviders.push({
      ...newProvider,
      provider: instance,
    });

    return {
      ...newProvider,
      chatModels: m.chat || [],
      embeddingModels: m.embedding || [],
    };
  }

  async removeProvider(providerId: string): Promise<void> {
    configManager.removeModelProvider(providerId);
    this.activeProviders = this.activeProviders.filter(
      (p) => p.id !== providerId,
    );

    return;
  }

  async updateProvider(
    providerId: string,
    name: string,
    config: any,
  ): Promise<ConfigModelProvider> {
    const updated = await configManager.updateModelProvider(
      providerId,
      name,
      config,
    );
    const instance = createProviderInstance(
      providers[updated.type],
      providerId,
      name,
      config,
      updated.chatModels,
      updated.embeddingModels,
    );

    let m: ModelList = { chat: [], embedding: [] };

    try {
      m = await instance.getModelList();
    } catch (err: any) {
      console.error(
        `Failed to get model list for updated provider. Type: ${updated.type}, ID: ${updated.id}, Error: ${err.message}`,
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

    this.activeProviders.push({
      ...updated,
      provider: instance,
    });

    return {
      ...updated,
      chatModels: m.chat || [],
      embeddingModels: m.embedding || [],
    };
  }

  /* Using async here because maybe in the future we might want to add some validation?? */
  async addProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    model: any,
  ): Promise<any> {
    const addedModel = configManager.addProviderModel(providerId, type, model);
    return addedModel;
  }

  async removeProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    modelKey: string,
  ): Promise<void> {
    configManager.removeProviderModel(providerId, type, modelKey);
    return;
  }
}

export default ModelRegistry;
