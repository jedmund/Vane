export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      console.log('Running database migrations...');
      await import('./lib/db/migrate');
      console.log('Database migrations completed successfully');
    } catch (error) {
      console.error('Failed to run database migrations:', error);
    }

    // Strip the stale modelProviders key from config.json before the
    // config manager reads the file. Order matters: ConfigManager loads
    // its in-memory copy during the import below, so the cleanup has to
    // run first to keep the on-disk and in-memory views consistent.
    try {
      const { stripStaleModelProvidersKey } = await import(
        './lib/config/cleanup'
      );
      stripStaleModelProvidersKey();
    } catch (error) {
      console.error('Failed to run config cleanup:', error);
    }

    await import('./lib/config/index');
  }
};
