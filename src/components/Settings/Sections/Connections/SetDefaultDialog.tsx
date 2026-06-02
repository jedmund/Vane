import { Dialog, DialogPanel } from '@headlessui/react';
import { Model } from '@/lib/models/types';
import { Loader2, Check } from 'lucide-react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import Select from '@/components/ui/Select';

export interface SetDefaultDialogProps {
  providerId: string;
  chatModels: Model[];
  embeddingModels: Model[];
}

const SetDefaultDialog = ({
  providerId,
  chatModels,
  embeddingModels,
  currentChatProviderId,
  currentChatModelKey,
  currentEmbeddingProviderId,
  currentEmbeddingModelKey,
  onSaved,
  children,
}: SetDefaultDialogProps & {
  currentChatProviderId: string | null;
  currentChatModelKey: string | null;
  currentEmbeddingProviderId: string | null;
  currentEmbeddingModelKey: string | null;
  onSaved: () => void;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [chatKey, setChatKey] = useState(
    currentChatProviderId === providerId ? currentChatModelKey ?? '' : '',
  );
  const [embeddingKey, setEmbeddingKey] = useState(
    currentEmbeddingProviderId === providerId
      ? currentEmbeddingModelKey ?? ''
      : '',
  );
  const [loading, setLoading] = useState(false);

  const hasChat = chatModels.length > 0;
  const hasEmbedding = embeddingModels.length > 0;

  const isDefaultChat =
    currentChatProviderId === providerId &&
    chatKey === currentChatModelKey;
  const isDefaultEmbedding =
    currentEmbeddingProviderId === providerId &&
    embeddingKey === currentEmbeddingModelKey;

  const handleSave = async () => {
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (hasChat) {
        body.chatProviderId = chatKey ? providerId : '';
        body.chatModelKey = chatKey || '';
      }
      if (hasEmbedding) {
        body.embeddingProviderId = embeddingKey ? providerId : '';
        body.embeddingModelKey = embeddingKey || '';
      }

      const res = await fetch('/api/providers/defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to set defaults');

      toast.success('Default models updated.');
      onSaved();
      setOpen(false);
    } catch (err) {
      console.error('Error setting defaults:', err);
      toast.error('Failed to set defaults.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div onClick={() => setOpen(true)}>{children}</div>
      <AnimatePresence>
        {open && (
          <Dialog
            static
            open={open}
            onClose={() => setOpen(false)}
            className="relative z-[60]"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="fixed inset-0 flex w-screen items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
            >
              <DialogPanel className="w-full mx-4 lg:w-[400px] flex flex-col border bg-light-primary dark:bg-dark-primary border-light-secondary dark:border-dark-secondary rounded-lg">
                <div className="px-6 pt-6 pb-4">
                  <h3 className="text-black/90 dark:text-white/90 font-medium text-sm">
                    Set as instance default
                  </h3>
                  <p className="text-[11px] text-black/50 dark:text-white/50 mt-1">
                    Users will inherit these models unless they choose their
                    own.
                  </p>
                </div>
                <div className="border-t border-light-200 dark:border-dark-200" />
                <div className="px-6 py-4 flex flex-col space-y-4">
                  {hasChat && (
                    <div className="flex flex-col items-start space-y-2">
                      <label className="text-xs text-black/70 dark:text-white/70">
                        Default chat model
                      </label>
                      <Select
                        value={chatKey}
                        onChange={(e) => setChatKey(e.target.value)}
                        options={[
                          { value: '', label: '— None —' },
                          ...chatModels.map((m) => ({
                            value: m.key,
                            label: m.name,
                          })),
                        ]}
                        className="!text-xs lg:!text-[13px]"
                      />
                      {isDefaultChat && (
                        <p className="text-[10px] text-sky-500 flex items-center gap-1">
                          <Check size={10} /> Currently the default
                        </p>
                      )}
                    </div>
                  )}
                  {hasEmbedding && (
                    <div className="flex flex-col items-start space-y-2">
                      <label className="text-xs text-black/70 dark:text-white/70">
                        Default embedding model
                      </label>
                      <Select
                        value={embeddingKey}
                        onChange={(e) => setEmbeddingKey(e.target.value)}
                        options={[
                          { value: '', label: '— None —' },
                          ...embeddingModels.map((m) => ({
                            value: m.key,
                            label: m.name,
                          })),
                        ]}
                        className="!text-xs lg:!text-[13px]"
                      />
                      {isDefaultEmbedding && (
                        <p className="text-[10px] text-sky-500 flex items-center gap-1">
                          <Check size={10} /> Currently the default
                        </p>
                      )}
                    </div>
                  )}
                  {!hasChat && !hasEmbedding && (
                    <p className="text-xs text-black/50 dark:text-white/50">
                      This provider has no models configured yet. Add models
                      first to set them as defaults.
                    </p>
                  )}
                </div>
                <div className="border-t border-light-200 dark:border-dark-200" />
                <div className="px-6 py-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={loading || (!hasChat && !hasEmbedding)}
                    className="px-4 py-2 rounded-lg text-[13px] bg-sky-500 text-white font-medium disabled:opacity-85 hover:opacity-85 active:scale-95 transition duration-200"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </DialogPanel>
            </motion.div>
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
};

export default SetDefaultDialog;
