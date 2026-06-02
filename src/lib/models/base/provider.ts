import { Model, ModelList, ProviderMetadata } from '../types';
import { UIConfigField } from '@/lib/config/types';
import BaseLLM from './llm';
import BaseEmbedding from './embedding';

abstract class BaseModelProvider<CONFIG> {
  // chatModels / embeddingModels are the operator-curated entries from the
  // providers row, passed in at construction. Previously each subclass
  // re-read them from config.json via getConfiguredModelProviderById; the
  // DB is now the source of truth and the registry resolves them once.
  constructor(
    protected id: string,
    protected name: string,
    protected config: CONFIG,
    protected chatModels: Model[] = [],
    protected embeddingModels: Model[] = [],
  ) {}
  abstract getDefaultModels(): Promise<ModelList>;
  abstract getModelList(): Promise<ModelList>;
  abstract loadChatModel(modelName: string): Promise<BaseLLM<any>>;
  abstract loadEmbeddingModel(modelName: string): Promise<BaseEmbedding<any>>;
  static getProviderConfigFields(): UIConfigField[] {
    throw new Error('Method not implemented.');
  }
  static getProviderMetadata(): ProviderMetadata {
    throw new Error('Method not Implemented.');
  }
  static parseAndValidate(raw: any): any {
    /* Static methods can't access class type parameters */
    throw new Error('Method not Implemented.');
  }
}

export type ProviderConstructor<CONFIG> = {
  new (
    id: string,
    name: string,
    config: CONFIG,
    chatModels?: Model[],
    embeddingModels?: Model[],
  ): BaseModelProvider<CONFIG>;
  parseAndValidate(raw: any): CONFIG;
  getProviderConfigFields: () => UIConfigField[];
  getProviderMetadata: () => ProviderMetadata;
};

export const createProviderInstance = <P extends ProviderConstructor<any>>(
  Provider: P,
  id: string,
  name: string,
  rawConfig: unknown,
  chatModels: Model[] = [],
  embeddingModels: Model[] = [],
): InstanceType<P> => {
  const cfg = Provider.parseAndValidate(rawConfig);
  return new Provider(id, name, cfg, chatModels, embeddingModels) as InstanceType<P>;
};

export default BaseModelProvider;
