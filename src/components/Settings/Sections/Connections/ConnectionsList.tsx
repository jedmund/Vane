import {
  ConfigModelProvider,
  ModelProviderUISection,
  UIConfigField,
} from '@/lib/config/types';
import { cn } from '@/lib/utils';
import { Loader2, Plug2 } from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import RevealSecretDialog from './RevealSecretDialog';
import EditConnectionDialog from './EditConnectionDialog';
import DeleteConnectionDialog from './DeleteConnectionDialog';
import SetDefaultDialog from './SetDefaultDialog';

type Scope = 'personal' | 'instance';

// Shared list shell used by both Personal Connections and Instance
// Connections. The two sections only differ in the scope filter applied on
// the client and in their empty-state copy, so the panel renders into a
// single component that takes both as props.
const ConnectionsList = ({
  scope,
  fields,
  emptyState,
}: {
  scope: Scope;
  fields: ModelProviderUISection[];
  emptyState: React.ReactNode;
}) => {
  const [providers, setProviders] = useState<ConfigModelProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaults, setDefaults] = useState<{
    chatProviderId: string | null;
    chatModelKey: string | null;
    embeddingProviderId: string | null;
    embeddingModelKey: string | null;
  }>({ chatProviderId: null, chatModelKey: null, embeddingProviderId: null, embeddingModelKey: null });

  const fetchDefaults = useCallback(async () => {
    try {
      const res = await fetch('/api/providers/defaults');
      if (res.ok) setDefaults(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchDefaults();
  }, [fetchDefaults]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // Use /api/providers (not /api/config) because the providers list
        // there is sourced directly from the DB with scope attached per row.
        // /api/config still ships an empty modelProviders array after the
        // Phase 1 backfill, which would break our scope filter here.
        const res = await fetch('/api/providers', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`/api/providers ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        const all: ConfigModelProvider[] = data.providers ?? [];
        setProviders(all.filter((p) => (p.scope ?? 'personal') === scope));
      } catch (err) {
        console.error('Error loading providers', err);
        if (!cancelled) toast.error('Failed to load connections.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Map provider type -> the UI field metadata used to render the edit form.
  // Looked up once per provider on render; the section receives this
  // metadata via the existing /api/config payload.
  const fieldsByType = useMemo(() => {
    const map: Record<string, UIConfigField[]> = {};
    fields.forEach((f) => {
      map[f.key] = f.fields as UIConfigField[];
    });
    return map;
  }, [fields]);

  const handleUpdated = (updated: ConfigModelProvider) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
    );
  };

  const handleDeleted = (id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2
          className="animate-spin text-black/50 dark:text-white/50"
          size={20}
        />
      </div>
    );
  }

  if (providers.length === 0) {
    return <div className="px-6 py-6">{emptyState}</div>;
  }

  return (
    <div className="flex flex-col gap-y-3 px-6 py-6">
      {providers.map((provider) => {
        const providerFields = fieldsByType[provider.type] ?? [];
        const modelCount =
          provider.chatModels.filter((m) => m.key !== 'error').length +
          provider.embeddingModels.filter((m) => m.key !== 'error').length;
        const rowScope: Scope = (provider.scope ?? 'personal') as Scope;

        return (
          <div
            key={`connection-row-${provider.id}`}
            className="border border-light-200 dark:border-dark-200 rounded-lg overflow-hidden bg-light-primary dark:bg-dark-primary"
          >
            <div className="px-5 py-3.5 flex flex-row justify-between w-full items-center">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-md bg-sky-500/10 dark:bg-sky-500/10 shrink-0">
                  <Plug2 size={14} className="text-sky-500" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex flex-row items-center gap-2 min-w-0">
                    <p className="text-sm text-black dark:text-white font-medium truncate">
                      {provider.name}
                    </p>
                    <span
                      className={cn(
                        'text-[9px] lg:text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0',
                        rowScope === 'instance'
                          ? 'bg-light-200 dark:bg-dark-200 text-black/60 dark:text-white/60'
                          : 'bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400',
                      )}
                    >
                      {rowScope === 'instance' ? 'Instance' : 'Personal'}
                    </span>
                  </div>
                  <p className="text-[10px] lg:text-[11px] text-black/50 dark:text-white/50">
                    {provider.type}
                    {modelCount > 0
                      ? ` · ${modelCount} model${modelCount !== 1 ? 's' : ''}`
                      : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-row items-center gap-1 shrink-0">
                {rowScope === 'instance' && (
                  <SetDefaultDialog
                    providerId={provider.id}
                    chatModels={provider.chatModels.filter((m) => m.key !== 'error')}
                    embeddingModels={provider.embeddingModels.filter((m) => m.key !== 'error')}
                    currentChatProviderId={defaults.chatProviderId}
                    currentChatModelKey={defaults.chatModelKey}
                    currentEmbeddingProviderId={defaults.embeddingProviderId}
                    currentEmbeddingModelKey={defaults.embeddingModelKey}
                    onSaved={fetchDefaults}
                  >
                    <button
                      type="button"
                      className={cn(
                        'group p-1.5 rounded-md transition-colors',
                        defaults.chatProviderId === provider.id || defaults.embeddingProviderId === provider.id
                          ? 'text-sky-500 hover:text-sky-600'
                          : 'text-black/40 dark:text-white/40 hover:text-black/70 hover:dark:text-white/70 hover:bg-light-200 hover:dark:bg-dark-200',
                      )}
                      title="Set as instance default"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill={defaults.chatProviderId === provider.id || defaults.embeddingProviderId === provider.id ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  </SetDefaultDialog>
                )}
                <RevealSecretDialog modelProvider={provider} />
                <EditConnectionDialog
                  modelProvider={provider}
                  fields={providerFields}
                  onUpdated={handleUpdated}
                />
                <DeleteConnectionDialog
                  modelProvider={provider}
                  onDeleted={handleDeleted}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ConnectionsList;
