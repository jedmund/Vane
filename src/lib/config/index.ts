import path from 'node:path';
import fs from 'fs';
import { Config, UIConfigSections } from './types';
import { getModelProvidersUIConfigSection } from '../models/providers';

class ConfigManager {
  configPath: string = path.join(
    process.env.DATA_DIR || process.cwd(),
    '/data/config.json',
  );
  configVersion = 1;
  // modelProviders has been removed from the on-disk shape; providers now
  // live in the SQLite providers table. The on-disk cleanup step that
  // strips a stale modelProviders key from existing config.json files runs
  // from src/lib/config/cleanup.ts at boot, before this manager reads.
  currentConfig: Config = {
    version: this.configVersion,
    setupComplete: false,
    preferences: {},
    personalization: {},
    search: {
      searxngURL: '',
    },
  };
  uiConfigSections: UIConfigSections = {
    preferences: [
      {
        name: 'Theme',
        key: 'theme',
        type: 'select',
        options: [
          {
            name: 'Light',
            value: 'light',
          },
          {
            name: 'Dark',
            value: 'dark',
          },
        ],
        required: false,
        description: 'Choose between light and dark layouts for the app.',
        default: 'dark',
        scope: 'client',
      },
      {
        name: 'Measurement Unit',
        key: 'measureUnit',
        type: 'select',
        options: [
          {
            name: 'Imperial',
            value: 'Imperial',
          },
          {
            name: 'Metric',
            value: 'Metric',
          },
        ],
        required: false,
        description: 'Choose between Metric  and Imperial measurement unit.',
        default: 'Metric',
        scope: 'client',
      },
      {
        name: 'Auto video & image search',
        key: 'autoMediaSearch',
        type: 'switch',
        required: false,
        description: 'Automatically search for relevant images and videos.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Show weather widget',
        key: 'showWeatherWidget',
        type: 'switch',
        required: false,
        description: 'Display the weather card on the home screen.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Show news widget',
        key: 'showNewsWidget',
        type: 'switch',
        required: false,
        description: 'Display the recent news card on the home screen.',
        default: true,
        scope: 'client',
      },
    ],
    personalization: [
      {
        name: 'System Instructions',
        key: 'systemInstructions',
        type: 'textarea',
        required: false,
        description: 'Add custom behavior or tone for the model.',
        placeholder:
          'e.g., "Respond in a friendly and concise tone" or "Use British English and format answers as bullet points."',
        scope: 'client',
      },
    ],
    modelProviders: [],
    search: [
      {
        name: 'SearXNG URL',
        key: 'searxngURL',
        type: 'string',
        required: false,
        description: 'The URL of your SearXNG instance',
        placeholder: 'http://localhost:4000',
        default: '',
        scope: 'server',
        env: 'SEARXNG_API_URL',
      },
    ],
  };

  constructor() {
    this.initialize();
  }

  private initialize() {
    this.initializeConfig();
    this.initializeFromEnv();
  }

  private saveConfig() {
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(this.currentConfig, null, 2),
    );
  }

  private initializeConfig() {
    const exists = fs.existsSync(this.configPath);
    if (!exists) {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.currentConfig, null, 2),
      );
    } else {
      try {
        this.currentConfig = JSON.parse(
          fs.readFileSync(this.configPath, 'utf-8'),
        );
      } catch (err) {
        if (err instanceof SyntaxError) {
          console.error(
            `Error parsing config file at ${this.configPath}:`,
            err,
          );
          console.log(
            'Loading default config and overwriting the existing file.',
          );
          fs.writeFileSync(
            this.configPath,
            JSON.stringify(this.currentConfig, null, 2),
          );
          return;
        } else {
          console.log('Unknown error reading config file:', err);
        }
      }

      this.currentConfig = this.migrateConfig(this.currentConfig);
    }
  }

  private migrateConfig(config: Config): Config {
    /* TODO: Add migrations */
    return config;
  }

  private initializeFromEnv() {
    // The UI sections for "Add a provider" still need to know which
    // provider types exist and what fields each one takes. That metadata
    // is populated here so the frontend's settings panel can render the
    // form. The env-derived provider INSTANCES that used to be seeded
    // alongside this metadata are gone; provider rows now live in the
    // SQLite providers table and are seeded by migration 0004 (which
    // backfilled from the pre-Phase 1 config.json).
    this.uiConfigSections.modelProviders = getModelProvidersUIConfigSection();

    /* search section */
    this.uiConfigSections.search.forEach((f) => {
      if (f.env && !this.currentConfig.search[f.key]) {
        this.currentConfig.search[f.key] =
          process.env[f.env] ?? f.default ?? '';
      }
    });

    this.saveConfig();
  }

  public getConfig(key: string, defaultValue?: any): any {
    const nested = key.split('.');
    let obj: any = this.currentConfig;

    for (let i = 0; i < nested.length; i++) {
      const part = nested[i];
      if (obj == null) return defaultValue;

      obj = obj[part];
    }

    return obj === undefined ? defaultValue : obj;
  }

  public updateConfig(key: string, val: any) {
    const parts = key.split('.');
    if (parts.length === 0) return;

    let target: any = this.currentConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (target[part] === null || typeof target[part] !== 'object') {
        target[part] = {};
      }

      target = target[part];
    }

    const finalKey = parts[parts.length - 1];
    target[finalKey] = val;

    this.saveConfig();
  }

  // Provider mutation methods removed. Providers live in the SQLite
  // providers table and writes happen in the /api/providers route handlers
  // via src/lib/db/providers.ts; the config-json-based mutators were dead
  // weight after Phase 1 made the DB the source of truth.

  public isSetupComplete() {
    return this.currentConfig.setupComplete;
  }

  public markSetupComplete() {
    if (!this.currentConfig.setupComplete) {
      this.currentConfig.setupComplete = true;
    }

    this.saveConfig();
  }

  public getUIConfigSections(): UIConfigSections {
    return this.uiConfigSections;
  }

  public getCurrentConfig(): Config {
    return JSON.parse(JSON.stringify(this.currentConfig));
  }
}

const configManager = new ConfigManager();

export default configManager;
