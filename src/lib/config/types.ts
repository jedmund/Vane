import { Model } from '../models/types';

type BaseUIConfigField = {
  name: string;
  key: string;
  required: boolean;
  description: string;
  scope: 'client' | 'server';
  env?: string;
};

type StringUIConfigField = BaseUIConfigField & {
  type: 'string';
  placeholder?: string;
  default?: string;
};

type SelectUIConfigFieldOptions = {
  name: string;
  value: string;
};

type SelectUIConfigField = BaseUIConfigField & {
  type: 'select';
  default?: string;
  options: SelectUIConfigFieldOptions[];
};

type PasswordUIConfigField = BaseUIConfigField & {
  type: 'password';
  placeholder?: string;
  default?: string;
};

type TextareaUIConfigField = BaseUIConfigField & {
  type: 'textarea';
  placeholder?: string;
  default?: string;
};

type SwitchUIConfigField = BaseUIConfigField & {
  type: 'switch';
  default?: boolean;
};

type UIConfigField =
  | StringUIConfigField
  | SelectUIConfigField
  | PasswordUIConfigField
  | TextareaUIConfigField
  | SwitchUIConfigField;

type ConfigModelProvider = {
  id: string;
  name: string;
  type: string;
  chatModels: Model[];
  embeddingModels: Model[];
  config: { [key: string]: any };
  hash: string;
  // Optional because the legacy /api/config payload still hydrates this type
  // from a code path that does not carry scope, and Phase 4 is the only
  // surface that guarantees the field. Consumers that need to gate UI on
  // scope must default-handle undefined (treat as 'personal' since list
  // visibility already filters to rows the caller owns plus instance rows).
  scope?: 'instance' | 'personal';
};

type Config = {
  version: number;
  // Kept on the type so existing config.json files deserialize without
  // schema errors; Phase 7 removed every code path that reads it.
  setupComplete: boolean;
  preferences: {
    [key: string]: any;
  };
  personalization: {
    [key: string]: any;
  };
  // Optional and effectively deprecated: providers now live in the SQLite
  // providers table, not config.json. The field is kept on the type so the
  // /api/config GET response can still surface a populated list (built from
  // the DB) for callers that have not yet migrated to /api/providers.
  modelProviders?: ConfigModelProvider[];
  search: {
    [key: string]: any;
  };
};

type EnvMap = {
  [key: string]: {
    fieldKey: string;
    providerKey: string;
  };
};

type ModelProviderUISection = {
  name: string;
  key: string;
  fields: UIConfigField[];
};

type UIConfigSections = {
  preferences: UIConfigField[];
  personalization: UIConfigField[];
  modelProviders: ModelProviderUISection[];
  search: UIConfigField[];
};

export type {
  UIConfigField,
  Config,
  EnvMap,
  UIConfigSections,
  SelectUIConfigField,
  StringUIConfigField,
  ModelProviderUISection,
  ConfigModelProvider,
  TextareaUIConfigField,
  SwitchUIConfigField,
};
