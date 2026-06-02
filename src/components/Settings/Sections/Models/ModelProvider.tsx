import { UIConfigField, ConfigModelProvider } from '@/lib/config/types';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Plug2, Plus, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import AddModel from './AddModelDialog';
import UpdateProvider from './UpdateProviderDialog';
import DeleteProvider from './DeleteProviderDialog';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';

const ModelProvider = ({
  modelProvider,
  setProviders,
  fields,
}: {
  modelProvider: ConfigModelProvider;
  fields: UIConfigField[];
  setProviders: React.Dispatch<React.SetStateAction<ConfigModelProvider[]>>;
}) => {
  const [open, setOpen] = useState(true);
  const { user } = useCurrentUser();

  // Scope is supplied by /api/providers (Phase 4). Older payloads that lack
  // it are treated as personal: the list endpoint only returns instance rows
  // plus the caller's own personal rows, so an unknown-scope row is always
  // one the caller is allowed to touch.
  const scope: 'instance' | 'personal' = modelProvider.scope ?? 'personal';
  const isAdmin = user?.isAdmin === true;
  const canMutate = isAdmin || scope === 'personal';

  const handleModelDelete = async (
    type: 'chat' | 'embedding',
    modelKey: string,
  ) => {
    try {
      const res = await fetch(`/api/providers/${modelProvider.id}/models`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: modelKey, type: type }),
      });

      if (!res.ok) {
        throw new Error('Failed to delete model: ' + (await res.text()));
      }

      setProviders(
        (prev) =>
          prev.map((provider) => {
            if (provider.id === modelProvider.id) {
              return {
                ...provider,
                ...(type === 'chat'
                  ? {
                      chatModels: provider.chatModels.filter(
                        (m) => m.key !== modelKey,
                      ),
                    }
                  : {
                      embeddingModels: provider.embeddingModels.filter(
                        (m) => m.key !== modelKey,
                      ),
                    }),
              };
            }
            return provider;
          }) as ConfigModelProvider[],
      );

      toast.success('Model deleted successfully.');
    } catch (err) {
      console.error('Failed to delete model', err);
      toast.error('Failed to delete model.');
    }
  };

  const modelCount =
    modelProvider.chatModels.filter((m) => m.key !== 'error').length +
    modelProvider.embeddingModels.filter((m) => m.key !== 'error').length;
  const hasError =
    modelProvider.chatModels.some((m) => m.key === 'error') ||
    modelProvider.embeddingModels.some((m) => m.key === 'error');

  return (
    <div
      key={modelProvider.id}
      className="border border-light-200 dark:border-dark-200 rounded-lg overflow-hidden bg-light-primary dark:bg-dark-primary"
    >
      <div className="px-5 py-3.5 flex flex-row justify-between w-full items-center border-b border-light-200 dark:border-dark-200 bg-light-secondary/30 dark:bg-dark-secondary/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-sky-500/10 dark:bg-sky-500/10">
            <Plug2 size={14} className="text-sky-500" />
          </div>
          <div className="flex flex-col">
            <div className="flex flex-row items-center gap-2">
              <p className="text-sm lg:text-sm text-black dark:text-white font-medium">
                {modelProvider.name}
              </p>
              {/* Scope badge sits next to the name so the row immediately reads
                  as instance- or personal-owned without an extra click. The
                  Instance badge is muted because it is meta information about
                  who manages the row, not a status the user needs to act on. */}
              <span
                className={cn(
                  'text-[9px] lg:text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded',
                  scope === 'instance'
                    ? 'bg-light-200 dark:bg-dark-200 text-black/60 dark:text-white/60'
                    : 'bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400',
                )}
              >
                {scope === 'instance' ? 'Instance' : 'Personal'}
              </span>
            </div>
            {modelCount > 0 && (
              <p className="text-[10px] lg:text-[11px] text-black/50 dark:text-white/50">
                {modelCount} model{modelCount !== 1 ? 's' : ''} configured
              </p>
            )}
          </div>
        </div>
        {canMutate && (
          <div className="flex flex-row items-center gap-1">
            <UpdateProvider
              fields={fields}
              modelProvider={modelProvider}
              setProviders={setProviders}
            />
            <DeleteProvider
              modelProvider={modelProvider}
              setProviders={setProviders}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-y-4 px-5 py-4">
        <div className="flex flex-col gap-y-2">
          <div className="flex flex-row w-full justify-between items-center">
            <p className="text-[11px] lg:text-[11px] font-medium text-black/70 dark:text-white/70 uppercase tracking-wide">
              Chat Models
            </p>
            {canMutate &&
              !modelProvider.chatModels.some((m) => m.key === 'error') && (
                <AddModel
                  providerId={modelProvider.id}
                  setProviders={setProviders}
                  type="chat"
                />
              )}
          </div>
          <div className="flex flex-col gap-2">
            {modelProvider.chatModels.some((m) => m.key === 'error') ? (
              <div className="flex flex-row items-center gap-2 text-xs lg:text-xs text-red-500 dark:text-red-400 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 border border-red-200 dark:border-red-900/30">
                <AlertCircle size={16} className="shrink-0" />
                <span className="break-words">
                  {
                    modelProvider.chatModels.find((m) => m.key === 'error')
                      ?.name
                  }
                </span>
              </div>
            ) : modelProvider.chatModels.filter((m) => m.key !== 'error')
                .length === 0 && !hasError ? (
              <div className="flex flex-col items-center justify-center py-4 px-4 rounded-lg border-2 border-dashed border-light-200 dark:border-dark-200 bg-light-secondary/20 dark:bg-dark-secondary/20">
                <p className="text-xs text-black/50 dark:text-white/50 text-center">
                  No chat models configured
                </p>
              </div>
            ) : modelProvider.chatModels.filter((m) => m.key !== 'error')
                .length > 0 ? (
              <div className="flex flex-row flex-wrap gap-2">
                {modelProvider.chatModels.map((model, index) => (
                  <div
                    key={`${modelProvider.id}-chat-${model.key}-${index}`}
                    className="flex flex-row items-center space-x-1.5 text-xs lg:text-xs text-black/70 dark:text-white/70 rounded-lg bg-light-secondary dark:bg-dark-secondary px-3 py-1.5 border border-light-200 dark:border-dark-200"
                  >
                    <span>{model.name}</span>
                    {canMutate && (
                      <button
                        onClick={() => {
                          handleModelDelete('chat', model.key);
                        }}
                        className="hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-y-2">
          <div className="flex flex-row w-full justify-between items-center">
            <p className="text-[11px] lg:text-[11px] font-medium text-black/70 dark:text-white/70 uppercase tracking-wide">
              Embedding Models
            </p>
            {canMutate &&
              !modelProvider.embeddingModels.some((m) => m.key === 'error') && (
                <AddModel
                  providerId={modelProvider.id}
                  setProviders={setProviders}
                  type="embedding"
                />
              )}
          </div>
          <div className="flex flex-col gap-2">
            {modelProvider.embeddingModels.some((m) => m.key === 'error') ? (
              <div className="flex flex-row items-center gap-2 text-xs lg:text-xs text-red-500 dark:text-red-400 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 border border-red-200 dark:border-red-900/30">
                <AlertCircle size={16} className="shrink-0" />
                <span className="break-words">
                  {
                    modelProvider.embeddingModels.find((m) => m.key === 'error')
                      ?.name
                  }
                </span>
              </div>
            ) : modelProvider.embeddingModels.filter((m) => m.key !== 'error')
                .length === 0 && !hasError ? (
              <div className="flex flex-col items-center justify-center py-4 px-4 rounded-lg border-2 border-dashed border-light-200 dark:border-dark-200 bg-light-secondary/20 dark:bg-dark-secondary/20">
                <p className="text-xs text-black/50 dark:text-white/50 text-center">
                  No embedding models configured
                </p>
              </div>
            ) : modelProvider.embeddingModels.filter((m) => m.key !== 'error')
                .length > 0 ? (
              <div className="flex flex-row flex-wrap gap-2">
                {modelProvider.embeddingModels.map((model, index) => (
                  <div
                    key={`${modelProvider.id}-embedding-${model.key}-${index}`}
                    className="flex flex-row items-center space-x-1.5 text-xs lg:text-xs text-black/70 dark:text-white/70 rounded-lg bg-light-secondary dark:bg-dark-secondary px-3 py-1.5 border border-light-200 dark:border-dark-200"
                  >
                    <span>{model.name}</span>
                    {canMutate && (
                      <button
                        onClick={() => {
                          handleModelDelete('embedding', model.key);
                        }}
                        className="hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelProvider;
