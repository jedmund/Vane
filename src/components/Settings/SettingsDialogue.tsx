import { Dialog, DialogPanel } from '@headlessui/react';
import {
  ArrowLeft,
  BrainCog,
  Building2,
  ChevronLeft,
  ExternalLink,
  Search,
  Sliders,
  ToggleRight,
  User,
} from 'lucide-react';
import Preferences from './Sections/Preferences';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Loader from '../ui/Loader';
import { cn } from '@/lib/utils';
import Models from './Sections/Models/Section';
import SearchSection from './Sections/Search';
import Select from '@/components/ui/Select';
import Personalization from './Sections/Personalization';
import PersonalConnections from './Sections/Connections/PersonalConnections';
import InstanceConnections from './Sections/Connections/InstanceConnections';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';

interface SettingsSection {
  key: string;
  name: string;
  description: string;
  icon: typeof Sliders;
  component: any;
  dataAdd: string;
  adminOnly?: boolean;
}

// Section group headers create visual separators in the sidebar. Sections
// before the first group header render in an unnamed group.
interface GroupHeader {
  kind: 'group';
  name: string;
}

type SidebarEntry = GroupHeader | SettingsSection;

// The first group (Preferences, Personalization, Models, Search) has no
// header. The second group is "Connections" and nests Personal / Instance.
const allSections: SettingsSection[] = [
  {
    key: 'preferences',
    name: 'Preferences',
    description: 'Customize your application preferences.',
    icon: Sliders,
    component: Preferences,
    dataAdd: 'preferences',
  },
  {
    key: 'personalization',
    name: 'Personalization',
    description: 'Customize the behavior and tone of the model.',
    icon: ToggleRight,
    component: Personalization,
    dataAdd: 'personalization',
  },
  {
    key: 'models',
    name: 'Models',
    description: 'Connect to AI services and manage connections.',
    icon: BrainCog,
    component: Models,
    dataAdd: 'modelProviders',
  },
  {
    key: 'search',
    name: 'Search',
    description: 'Manage search settings.',
    icon: Search,
    component: SearchSection,
    dataAdd: 'search',
  },
];

const connectionSections: SettingsSection[] = [
  {
    key: 'personal-connections',
    name: 'Personal',
    description: 'Manage the AI connections only you can see.',
    icon: User,
    component: PersonalConnections,
    dataAdd: 'modelProviders',
  },
  {
    key: 'instance-connections',
    name: 'Instance',
    description: 'Manage the shared AI connections every user can see.',
    icon: Building2,
    component: InstanceConnections,
    dataAdd: 'modelProviders',
    adminOnly: true,
  },
];

const SettingsDialogue = ({
  isOpen,
  setIsOpen,
  initialSection,
}: {
  isOpen: boolean;
  setIsOpen: (active: boolean) => void;
  // Optional deep-link target so callers (e.g. the empty-providers banner
  // on the chat UI) can open the dialogue directly to a specific panel
  // instead of always landing on the first section.
  initialSection?: string;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);
  const { user } = useCurrentUser();
  const isAdmin = user?.isAdmin === true;

  // Filter sections by admin status. Doing this in a memo (rather than at
  // module scope) keeps the list reactive to /api/me resolving after first
  // render, so admins do not have to refresh to see the Instance Connections
  // entry on initial load.
  const sections = useMemo(
    () => allSections.filter((s) => !s.adminOnly || isAdmin),
    [isAdmin],
  );

  const visibleConnections = useMemo(
    () => connectionSections.filter((s) => !s.adminOnly || isAdmin),
    [isAdmin],
  );

  const allVisible = useMemo(
    () => [...allSections, ...connectionSections].filter((s) => !s.adminOnly || isAdmin),
    [isAdmin],
  );

  const [activeSection, setActiveSection] = useState<string>(
    initialSection ?? allSections[0].key,
  );
  const selectedSection =
    allVisible.find((s) => s.key === activeSection) ?? allVisible[0];

  // If the active section disappears because admin status flipped (e.g. the
  // user data loaded after the initial render), snap back to a section that
  // is still in the visible list.
  useEffect(() => {
    if (!allVisible.find((s) => s.key === activeSection)) {
      setActiveSection(allVisible[0].key);
    }
  }, [allVisible, activeSection]);

  // When the dialogue is opened with a specific initialSection (e.g. from
  // the empty-providers banner on the chat page), snap to that section each
  // time it opens, not just on the very first mount. Otherwise the second
  // click would land the user wherever they previously navigated.
  useEffect(() => {
    if (isOpen && initialSection) {
      setActiveSection(initialSection);
    }
  }, [isOpen, initialSection]);

  useEffect(() => {
    if (isOpen) {
      const fetchConfig = async () => {
        try {
          const res = await fetch('/api/config', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          const data = await res.json();

          setConfig(data);
        } catch (error) {
          console.error('Error fetching config:', error);
          toast.error('Failed to load configuration.');
        } finally {
          setIsLoading(false);
        }
      };

      fetchConfig();
    }
  }, [isOpen]);

  return (
    <Dialog
      open={isOpen}
      onClose={() => setIsOpen(false)}
      className="relative z-50"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        className="fixed inset-0 flex w-screen items-center justify-center p-4 bg-black/30 backdrop-blur-sm h-screen"
      >
        <DialogPanel className="space-y-4 border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary backdrop-blur-lg rounded-xl h-[calc(100vh-2%)] w-[calc(100vw-2%)] md:h-[calc(100vh-7%)] md:w-[calc(100vw-7%)] lg:h-[calc(100vh-20%)] lg:w-[calc(100vw-30%)] overflow-hidden flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center h-full w-full">
              <Loader />
            </div>
          ) : (
            <div className="flex flex-1 inset-0 h-full overflow-hidden">
              <div className="hidden lg:flex flex-col justify-between w-[240px] border-r border-white-200 dark:border-dark-200 h-full px-3 pt-3 overflow-y-auto">
                <div className="flex flex-col">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="group flex flex-row items-center hover:bg-light-200 hover:dark:bg-dark-200 p-2 rounded-lg"
                  >
                    <ChevronLeft
                      size={18}
                      className="text-black/50 dark:text-white/50 group-hover:text-black/70 group-hover:dark:text-white/70"
                    />
                    <p className="text-black/50 dark:text-white/50 group-hover:text-black/70 group-hover:dark:text-white/70 text-[14px]">
                      Back
                    </p>
                  </button>

                  <div className="flex flex-col items-start space-y-1 mt-8">
                    {sections.map((section) => (
                      <button
                        key={section.key}
                        className={cn(
                          `flex flex-row items-center space-x-2 px-2 py-1.5 rounded-lg w-full text-sm hover:bg-light-200 hover:dark:bg-dark-200 transition duration-200 active:scale-95`,
                          activeSection === section.key
                            ? 'bg-light-200 dark:bg-dark-200 text-black/90 dark:text-white/90'
                            : ' text-black/70 dark:text-white/70',
                        )}
                        onClick={() => setActiveSection(section.key)}
                      >
                        <section.icon size={17} />
                        <p>{section.name}</p>
                      </button>
                    ))}
                    {visibleConnections.length > 0 && (
                      <>
                        <div className="w-full pt-3 pb-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40 dark:text-white/40 px-2">
                            Connections
                          </p>
                        </div>
                        {visibleConnections.map((section) => (
                          <button
                            key={section.key}
                            className={cn(
                              `flex flex-row items-center space-x-2 px-2 py-1.5 rounded-lg w-full text-sm hover:bg-light-200 hover:dark:bg-dark-200 transition duration-200 active:scale-95`,
                              activeSection === section.key
                                ? 'bg-light-200 dark:bg-dark-200 text-black/90 dark:text-white/90'
                                : ' text-black/70 dark:text-white/70',
                            )}
                            onClick={() => setActiveSection(section.key)}
                          >
                            <section.icon size={17} />
                            <p>{section.name}</p>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col space-y-1 py-[18px] px-2">
                  <p className="text-xs text-black/70 dark:text-white/70">
                    Version: {process.env.NEXT_PUBLIC_VERSION}
                  </p>
                  <a
                    href="https://github.com/itzcrazykns/vane"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-black/70 dark:text-white/70 flex flex-row space-x-1 items-center transition duration-200 hover:text-black/90 hover:dark:text-white/90"
                  >
                    <span>GitHub</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
              <div className="w-full flex flex-col overflow-hidden">
                <div className="flex flex-row lg:hidden w-full justify-between px-[20px] my-4 flex-shrink-0">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="group flex flex-row items-center hover:bg-light-200 hover:dark:bg-dark-200 rounded-lg mr-[40%]"
                  >
                    <ArrowLeft
                      size={18}
                      className="text-black/50 dark:text-white/50 group-hover:text-black/70 group-hover:dark:text-white/70"
                    />
                  </button>
                  <Select
                    options={allVisible.map((section) => {
                      return {
                        value: section.key,
                        key: section.key,
                        label: section.name,
                      };
                    })}
                    value={activeSection}
                    onChange={(e) => {
                      setActiveSection(e.target.value);
                    }}
                    className="!text-xs lg:!text-sm"
                  />
                </div>
                {selectedSection.component && (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="border-b border-light-200/60 px-6 pb-6 lg:pt-6 dark:border-dark-200/60 flex-shrink-0">
                      <div className="flex flex-col">
                        <h4 className="font-medium text-black dark:text-white text-sm lg:text-sm">
                          {selectedSection.name}
                        </h4>
                        <p className="text-[11px] lg:text-xs text-black/50 dark:text-white/50">
                          {selectedSection.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <selectedSection.component
                        fields={config.fields[selectedSection.dataAdd]}
                        values={config.values[selectedSection.dataAdd]}
                        onNavigate={setActiveSection}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogPanel>
      </motion.div>
    </Dialog>
  );
};

export default SettingsDialogue;
