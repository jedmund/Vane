import {
  Description,
  Dialog,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ConfigModelProvider,
  ModelProviderUISection,
  StringUIConfigField,
  UIConfigField,
} from '@/lib/config/types';
import Select from '@/components/ui/Select';
import { toast } from 'sonner';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';

const AddProvider = ({
  modelProviders,
  setProviders,
}: {
  modelProviders: ModelProviderUISection[];
  setProviders: React.Dispatch<React.SetStateAction<ConfigModelProvider[]>>;
}) => {
  const [open, setOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<null | string>(
    modelProviders[0]?.key || null,
  );
  const [config, setConfig] = useState<Record<string, any>>({});
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  // Default to instance for admins because the historical Add Provider flow
  // (before the admin/user split) always created what is now an instance row.
  // Personal stays an opt-in for admins who want to add their own keys.
  const [scope, setScope] = useState<'instance' | 'personal'>('instance');

  const { user } = useCurrentUser();
  const isAdmin = user?.isAdmin === true;

  // Reset form state when the dialog closes so the next open starts from
  // defaults. Without this, scope sticks at whatever the admin last picked
  // (surprising: default is Instance), and stale config from a previous
  // type would survive until the user touches the type selector.
  useEffect(() => {
    if (open) return;
    setSelectedProvider(modelProviders[0]?.key || null);
    setConfig({});
    setName('');
    setScope('instance');
  }, [open, modelProviders]);

  const providerConfigMap = useMemo(() => {
    const map: Record<string, { name: string; fields: UIConfigField[] }> = {};

    modelProviders.forEach((p) => {
      map[p.key] = {
        name: p.name,
        fields: p.fields,
      };
    });

    return map;
  }, [modelProviders]);

  const selectedProviderFields = useMemo(() => {
    if (!selectedProvider) return [];
    const providerFields = providerConfigMap[selectedProvider]?.fields || [];
    const config: Record<string, any> = {};

    providerFields.forEach((field) => {
      config[field.key] = field.default || '';
    });

    setConfig(config);

    return providerFields;
  }, [selectedProvider, providerConfigMap]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: selectedProvider,
          name: name,
          config: config,
          // Only send scope when the caller is admin; non-admins always get
          // the server-side default ('personal') and avoid sending a field
          // they cannot legitimately set.
          ...(isAdmin ? { scope } : {}),
        }),
      });

      if (!res.ok) {
        // The two 403 bodies from /api/providers (admin_required and
        // forbidden) map to distinct user-facing messages so a non-admin
        // who somehow attempts an instance write sees why it failed
        // instead of a generic 'failed to add provider'.
        if (res.status === 403) {
          let code: string | null = null;
          try {
            const body = await res.json();
            code = body?.error ?? null;
          } catch {
            // Body was not JSON; fall through to generic 403 message.
          }
          if (code === 'admin_required') {
            toast.error(
              'Admin role required to create an instance connection.',
            );
          } else if (code === 'forbidden') {
            toast.error('This connection belongs to another user.');
          } else {
            toast.error('You do not have permission to add this connection.');
          }
          return;
        }
        throw new Error('Failed to add provider');
      }

      const data: ConfigModelProvider = (await res.json()).provider;

      setProviders((prev) => [...prev, data]);

      toast.success('Connection added successfully.');
      setOpen(false);
    } catch (error) {
      console.error('Error adding provider:', error);
      toast.error('Failed to add connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs sm:text-xs border border-light-200 dark:border-dark-200 text-black dark:text-white bg-light-secondary/50 dark:bg-dark-secondary/50 hover:bg-light-secondary hover:dark:bg-dark-secondary hover:border-light-300 hover:dark:border-dark-300 flex flex-row items-center space-x-1 active:scale-95 transition duration-200"
      >
        <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />
        <span>Add Connection</span>
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
                      Add new connection
                    </h3>
                  </div>
                  <div className="border-t border-light-200 dark:border-dark-200" />
                  <div className="flex-1 overflow-y-auto px-6 py-4">
                    <div className="flex flex-col space-y-4">
                      {isAdmin && (
                        <div className="flex flex-col items-start space-y-2">
                          <label className="text-xs text-black/70 dark:text-white/70">
                            Scope
                          </label>
                          {/* Two-button toggle rather than a Select so the
                              choice is visible at a glance; only admins see
                              this control, and it has exactly two options. */}
                          <div className="flex flex-row gap-2 w-full">
                            <button
                              type="button"
                              onClick={() => setScope('instance')}
                              className={
                                scope === 'instance'
                                  ? 'flex-1 px-3 py-2 rounded-lg text-xs border border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium transition'
                                  : 'flex-1 px-3 py-2 rounded-lg text-xs border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 text-black/70 dark:text-white/70 hover:border-light-300 hover:dark:border-dark-300 transition'
                              }
                            >
                              Instance
                            </button>
                            <button
                              type="button"
                              onClick={() => setScope('personal')}
                              className={
                                scope === 'personal'
                                  ? 'flex-1 px-3 py-2 rounded-lg text-xs border border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium transition'
                                  : 'flex-1 px-3 py-2 rounded-lg text-xs border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 text-black/70 dark:text-white/70 hover:border-light-300 hover:dark:border-dark-300 transition'
                              }
                            >
                              Personal
                            </button>
                          </div>
                          <p className="text-[10px] text-black/50 dark:text-white/50">
                            Instance connections are shared with everyone on
                            this server. Personal connections are only visible
                            to you.
                          </p>
                        </div>
                      )}
                      <div className="flex flex-col items-start space-y-2">
                        <label className="text-xs text-black/70 dark:text-white/70">
                          Select connection type
                        </label>
                        <Select
                          value={selectedProvider ?? ''}
                          onChange={(e) => setSelectedProvider(e.target.value)}
                          options={Object.entries(providerConfigMap).map(
                            ([key, val]) => {
                              return {
                                label: val.name,
                                value: key,
                              };
                            },
                          )}
                        />
                      </div>

                      <div
                        key="name"
                        className="flex flex-col items-start space-y-2"
                      >
                        <label className="text-xs text-black/70 dark:text-white/70">
                          Connection Name*
                        </label>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-4 py-3 pr-10 text-sm text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus-visible:outline-none focus-visible:border-light-300 dark:focus-visible:border-dark-300 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder={'e.g., My OpenAI Connection'}
                          type="text"
                          required={true}
                        />
                      </div>

                      {selectedProviderFields.map((field: UIConfigField) => (
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
                  </div>
                  <div className="border-t border-light-200 dark:border-dark-200" />
                  <div className="px-6 py-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 rounded-lg text-[13px] bg-sky-500 text-white font-medium disabled:opacity-85 hover:opacity-85 active:scale-95 transition duration-200"
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        'Add Connection'
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

export default AddProvider;
