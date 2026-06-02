'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plug } from 'lucide-react';
import SettingsDialogue from './Settings/SettingsDialogue';

// Persistent banner shown on the chat UI whenever the caller has zero
// visible providers (no instance providers AND no personal providers).
// Replaces the upstream Welcome / SetupWizard first-run modal; users land
// on the chat surface and get a single inline nudge to add a connection.
//
// Not dismissible: without a provider the chat does not function, so the
// banner is a functional gate, not informational chrome. The provider list
// is refetched whenever the dialogue closes so adding a connection makes
// the banner disappear without a full page reload.
const EmptyProvidersBanner = () => {
  const [providerCount, setProviderCount] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers', { credentials: 'same-origin' });
      if (!res.ok) {
        // 401 during the brief window after OIDC login but before cookies
        // settle should not surface as a banner; suppress the noise and try
        // again on the next user-driven trigger.
        setProviderCount(null);
        return;
      }
      const data = await res.json();
      const providers = Array.isArray(data?.providers) ? data.providers : [];
      setProviderCount(providers.length);
    } catch {
      setProviderCount(null);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  // Refresh count when the settings dialogue closes so adding a connection
  // immediately clears the banner without a page reload.
  useEffect(() => {
    if (!settingsOpen) {
      fetchProviders();
    }
  }, [settingsOpen]);

  if (providerCount === null || providerCount > 0) return null;

  return (
    <>
      <div className="fixed top-0 left-0 lg:left-[72px] right-0 z-30 px-4 pt-4 pointer-events-none">
        <div className="pointer-events-auto mx-auto max-w-3xl flex flex-row items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <div className="flex-shrink-0 p-1.5 rounded-full bg-sky-500/15 text-sky-500">
            <Plug size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm font-medium text-black dark:text-white">
              No connections configured yet
            </p>
            <p className="text-[11px] sm:text-xs text-black/60 dark:text-white/60">
              Add one in Settings to start chatting.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-sky-500 hover:bg-sky-600 active:scale-95 transition duration-200"
          >
            Open Settings
          </button>
        </div>
      </div>
      <AnimatePresence>
        {settingsOpen && (
          <SettingsDialogue
            isOpen={settingsOpen}
            setIsOpen={setSettingsOpen}
            initialSection="personal-connections"
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default EmptyProvidersBanner;
