import { Dialog, DialogPanel } from '@headlessui/react';
import { Check, Copy, Eye, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ConfigModelProvider } from '@/lib/config/types';
import { toast } from 'sonner';

type RevealedSecret = {
  id: string;
  name: string;
  type: string;
  scope: 'instance' | 'personal';
  config: Record<string, any>;
  chatModels: { key: string; name: string }[];
  embeddingModels: { key: string; name: string }[];
};

// Modal rather than inline reveal: the api_key is sensitive enough that the
// user should take a deliberate action (open) and the close action becomes
// the obvious "hide" trigger. Copying from a modal is also more accessible
// than from a row that may scroll off-screen mid-copy.
const RevealSecretDialog = ({
  modelProvider,
}: {
  modelProvider: ConfigModelProvider;
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Drop the secret from React state as soon as the modal closes so an
      // accidental devtools snapshot doesn't capture it longer than needed.
      setSecret(null);
      setCopiedKey(null);
      return;
    }

    let cancelled = false;
    const fetchSecret = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/providers/${modelProvider.id}/secret`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          if (res.status === 403) {
            toast.error('You are not allowed to view this connection.');
          } else {
            toast.error('Failed to load connection details.');
          }
          if (!cancelled) setOpen(false);
          return;
        }

        const data = await res.json();
        if (!cancelled) setSecret(data.provider as RevealedSecret);
      } catch (err) {
        console.error('Error revealing provider secret', err);
        toast.error('Failed to load connection details.');
        if (!cancelled) setOpen(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSecret();
    return () => {
      cancelled = true;
    };
  }, [open, modelProvider.id]);

  // Tracks the in-flight "Copied!" indicator clear so we can cancel it on
  // modal close (otherwise it fires against an unmounted component, no-op
  // but sloppy, and keeps the "Copied!" state visible to devtools snapshots
  // taken in the 1500ms window before unmount).
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) return;
    if (copyResetTimeoutRef.current !== null) {
      clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
    setCopiedKey(null);
  }, [open]);

  const handleCopy = async (fieldKey: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(fieldKey);
      // Short-lived visual confirmation; no toast on top of the modal so it
      // does not stack on Headless UI's portal layer.
      if (copyResetTimeoutRef.current !== null) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = setTimeout(() => {
        copyResetTimeoutRef.current = null;
        setCopiedKey((current) => (current === fieldKey ? null : current));
      }, 1500);
    } catch (err) {
      console.error('Clipboard write failed', err);
      toast.error('Failed to copy to clipboard.');
    }
  };

  const renderConfigEntries = () => {
    if (!secret) return null;
    const entries = Object.entries(secret.config ?? {});

    if (entries.length === 0) {
      return (
        <p className="text-xs text-black/50 dark:text-white/50">
          This connection has no stored configuration values.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        {entries.map(([key, rawValue]) => {
          const value =
            typeof rawValue === 'string'
              ? rawValue
              : JSON.stringify(rawValue, null, 2);
          const isCopied = copiedKey === key;

          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-wide text-black/60 dark:text-white/60">
                {key}
              </label>
              <div className="flex flex-row items-stretch gap-2">
                <div className="flex-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 px-3 py-2 font-mono text-[12px] text-black/80 dark:text-white/80 break-all whitespace-pre-wrap">
                  {value || (
                    <span className="text-black/40 dark:text-white/40">
                      (empty)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(key, value)}
                  className="px-2.5 rounded-lg border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 hover:bg-light-secondary hover:dark:bg-dark-secondary text-black/70 dark:text-white/70 active:scale-95 transition flex items-center justify-center"
                  title={isCopied ? 'Copied' : 'Copy to clipboard'}
                >
                  {isCopied ? (
                    <Check size={14} className="text-emerald-500" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="group p-1.5 rounded-md hover:bg-light-200 hover:dark:bg-dark-200 transition-colors"
        title="Reveal connection details"
      >
        <Eye
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
                <div className="px-6 pt-6 pb-4 flex flex-col gap-1">
                  <h3 className="text-black/90 dark:text-white/90 font-medium text-sm">
                    Connection details
                  </h3>
                  <p className="text-xs text-black/50 dark:text-white/50">
                    {modelProvider.name}
                  </p>
                </div>
                <div className="border-t border-light-200 dark:border-dark-200" />
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {loading || !secret ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2
                        className="animate-spin text-black/50 dark:text-white/50"
                        size={18}
                      />
                    </div>
                  ) : (
                    renderConfigEntries()
                  )}
                </div>
                <div className="border-t border-light-200 dark:border-dark-200" />
                <div className="px-6 py-4 flex justify-end">
                  <button
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg text-[13px] border border-light-200 dark:border-dark-200 text-black dark:text-white bg-light-secondary/50 dark:bg-dark-secondary/50 hover:bg-light-secondary hover:dark:bg-dark-secondary hover:border-light-300 hover:dark:border-dark-300 active:scale-95 transition duration-200"
                  >
                    Close
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

export default RevealSecretDialog;
