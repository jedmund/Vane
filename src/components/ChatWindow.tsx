'use client';

import { useState, useEffect } from 'react';
import Navbar from './Navbar';
import Chat from './Chat';
import EmptyChat from './EmptyChat';
import NextError from 'next/error';
import { useChat } from '@/lib/hooks/useChat';
import SettingsDialogue from './Settings/SettingsDialogue';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { AnimatePresence } from 'framer-motion';
import { Block } from '@/lib/types';
import Loader from './ui/Loader';
import EmptyProvidersBanner from './EmptyProvidersBanner';

export interface BaseMessage {
  chatId: string;
  messageId: string;
  createdAt: Date;
}

export interface Message extends BaseMessage {
  backendId: string;
  query: string;
  responseBlocks: Block[];
  status: 'answering' | 'completed' | 'error';
}

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

export interface Widget {
  widgetType: string;
  params: Record<string, any>;
}

const ChatWindow = () => {
  const { hasError, notFound, messages, isReady } = useChat();
  const { user, loading: userLoading } = useCurrentUser();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Auto-open settings on error, deep-linking to Connections. Admins get
  // the Instance panel (they can add shared providers); non-admins get
  // Personal (they can add their own).
  useEffect(() => {
    if (hasError && !userLoading) {
      setSettingsOpen(true);
    }
  }, [hasError, userLoading]);

  const isAdmin = user?.isAdmin === true;
  const initialSection = isAdmin
    ? 'instance-connections'
    : 'personal-connections';

  if (hasError) {
    return (
      <>
        <div className="relative">
          <div className="flex flex-col items-center justify-center min-h-screen">
            <p className="dark:text-white/70 text-black/70 text-sm">
              Failed to connect to the server. Please try again later.
            </p>
          </div>
        </div>
        <AnimatePresence>
          {settingsOpen && (
            <SettingsDialogue
              isOpen={settingsOpen}
              setIsOpen={setSettingsOpen}
              initialSection={initialSection}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  return isReady ? (
    notFound ? (
      <NextError statusCode={404} />
    ) : (
      <div>
        <EmptyProvidersBanner />
        {messages.length > 0 ? (
          <>
            <Navbar />
            <Chat />
          </>
        ) : (
          <EmptyChat />
        )}
      </div>
    )
  ) : (
    <div className="flex items-center justify-center min-h-screen w-full">
      <Loader />
    </div>
  );
};

export default ChatWindow;
