import { Dialog, DialogPanel } from '@headlessui/react';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Model } from '@/lib/models/types';
import { toast } from 'sonner';

const RenameModelDialog = ({
  providerId,
  model,
  type,
  onRenamed,
  children,
}: {
  providerId: string;
  model: Model;
  type: 'chat' | 'embedding';
  onRenamed: (key: string, newName: string) => void;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(model.name);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/models`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: model.key, name, type }),
      });

      if (!res.ok) throw new Error('Failed to rename model');

      onRenamed(model.key, name);
      toast.success('Model renamed successfully.');
      setOpen(false);
    } catch (err) {
      console.error('Error renaming model:', err);
      toast.error('Failed to rename model.');
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
                <form onSubmit={handleSubmit} className="flex flex-col">
                  <div className="px-6 pt-6 pb-4">
                    <h3 className="text-black/90 dark:text-white/90 font-medium text-sm">
                      Rename model
                    </h3>
                  </div>
                  <div className="border-t border-light-200 dark:border-dark-200" />
                  <div className="px-6 py-4 flex flex-col space-y-4">
                    <div className="flex flex-col items-start space-y-2">
                      <label className="text-xs text-black/70 dark:text-white/70">
                        Model key
                      </label>
                      <p className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-secondary dark:bg-dark-secondary px-4 py-3 text-[13px] text-black/50 dark:text-white/50">
                        {model.key}
                      </p>
                    </div>
                    <div className="flex flex-col items-start space-y-2">
                      <label className="text-xs text-black/70 dark:text-white/70">
                        Display name*
                      </label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-4 py-3 text-[13px] text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus-visible:outline-none focus-visible:border-light-300 dark:focus-visible:border-dark-300 transition-colors"
                        type="text"
                        required
                      />
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
                        'Save'
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

export default RenameModelDialog;
