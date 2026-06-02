import configManager from './index';

// Providers used to live here; they now live in the SQLite providers table
// and are read via src/lib/db/providers.ts. SearXNG URL stays in
// data/config.json because it is a global server setting, not a per-user
// connection.
export const getSearxngURL = () =>
  configManager.getConfig('search.searxngURL', '');
