import { Dialog, DialogPanel } from '@headlessui/react';
import { Loader2, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ConfigModelProvider,
  StringUIConfigField,
  UIConfigField,
} from '@/lib/config/types';
import { toast } from 'sonner';

// Edit dialog for the Connections panels. Distinct from the existing
// UpdateProviderDialog in the Models section because that one is hydrated
// from /api/config (which strips api_key); here we fetch the secret first
// so the api_key input is pre-populated and the user does not have to
// retype credentials they already saved.
const EditConnectionDialog = ({
  modelProvider,
  fields,
  onUpdated,
}: {
  modelProvider: ConfigModelProvider;
  fields: UIConfigField[];
  onUpdated: (updated: ConfigModelProvider) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [name, setName] = useState(modelProvider.name);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfig({});
      setName(modelProvider.name);
      return;
    }

    let cancelled = false;
    const hydrate = async () => {
      setHydrating(true);
      try {
        const res = await fetch(`/api/providers/${modelProvider.id}/secret`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          if (res.status === 403) {
            toast.error('You are not allowed to edit this connection.');
          } else {
            toast.error('Failed to load connection.');
          }
          if (!cancelled) setOpen(false);
          return;
        }

        const data = await res.json();
        const fetched = data.provider as {
          name: string;
          config: Record<string, any>;
        };

        if (cancelled) return;

        // Seed the form with the live values from the DB. If a field has
        // never had a value (legacy row, new field in provider schema)
        // fall back to the schema default to keep the input controlled.
        const next: Record<string, any> = {};
        fields.forEach((field) => {
          next[field.key] = fetched.config?.[field.key] ?? field.default ?? '';
        });
        setConfig(next);
        setName(fetched.name);
      } catch (err) {
        console.error('Error hydrating edit form', err);
        toast.error('Failed to load connection.');
        if (!cancelled) setOpen(false);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [open, modelProvider.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Defensive guard against submitting before hydration finishes. The
    // submit button is disabled while `hydrating` is true, but a future
    // refactor that removes that disable could expose an empty-form save
    // and silently wipe the stored config. Bail loudly instead.
    if (Object.keys(config).length === 0) {
      toast.error('Connection has not finished loading yet.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/providers/${modelProvider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      });

      if (!res.ok) {
        throw new Error('Failed to update provider');
      }

      const data = (await res.json()).provider as ConfigModelProvider;
      onUpdated(data);
      toast.success('Connection updated successfully.');
      setOpen(false);
    } catch (err) {
      console.error('Error updating provider', err);
      toast.error('Failed to update connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="group p-1.5 rounded-md hover:bg-light-200 hover:dark:bg-dark-200 transition-colors"
        title="Edit connection"
      >
        <Pencil
          size={14}
          className="text-black/60 dark:text-white/60 group-hover:text-black group-hover:dark:text-white"
        />
      </button>
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
              <DialogPanel className="w-full mx-4 lg:w-[600px] max-h-[85vh] flex flex-col border bg-light-primary dark:bg-dark-primary border-light-secondary dark:border-dark-secondary rounded-lg">
                <form onSubmit={handleSubmit} className="flex flex-col flex-1">
                  <div className="px-6 pt-6 pb-4">
                    <h3 className="text-black/90 dark:text-white/90 font-medium text-sm">
                      Edit connection
                    </h3>
                  </div>
                  <div className="border-t border-light-200 dark:border-dark-200" />
                  <div className="flex-1 overflow-y-auto px-6 py-4">
                    {hydrating ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2
                          className="animate-spin text-black/50 dark:text-white/50"
                          size={18}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col space-y-4">
                        <div
                          key="name"
                          className="flex flex-col items-start space-y-2"
                        >
                          <label className="text-xs text-black/70 dark:text-white/70">
                            Connection Name*
                          </label>
                          <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-4 py-3 pr-10 text-sm text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus-visible:outline-none focus-visible:border-light-300 dark:focus-visible:border-dark-300 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder={'Connection Name'}
                            type="text"
                            required={true}
                          />
                        </div>

                        {fields.map((field: UIConfigField) => (
                          <div
                            key={field.key}
                            className="flex flex-col items-start space-y-2"
                          >
                            <label className="text-xs text-black/70 dark:text-white/70">
                              {field.name}
                              {field.required && '*'}
                            </label>
                            <input
                              value={config[field.key] ?? field.default ?? ''}
                              onChange={(event) =>
                                setConfig((prev) => ({
                                  ...prev,
                                  [field.key]: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-4 py-3 pr-10 text-[13px] text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus-visible:outline-none focus-visible:border-light-300 dark:focus-visible:border-dark-300 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder={
                                (field as StringUIConfigField).placeholder
                              }
                              type="text"
                              required={field.required}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-light-200 dark:border-dark-200" />
                  <div className="px-6 py-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading || hydrating}
                      className="px-4 py-2 rounded-lg text-[13px] bg-sky-500 text-white font-medium disabled:opacity-85 hover:opacity-85 active:scale-95 transition duration-200"
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        'Save changes'
                      )}
                    </button>
                  </div>
                </form>
              </DialogPanel>
            </motion.div>
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
};

export default EditConnectionDialog;
