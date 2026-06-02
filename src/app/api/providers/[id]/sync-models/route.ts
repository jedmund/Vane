import { NextRequest } from 'next/server';
import {
  adminRequiredResponse,
  getCurrentUserId,
  isUserAdmin,
  MissingUserIdHeaderError,
  missingUserIdResponse,
  ownershipErrorResponse,
} from '@/lib/db/scoped';
import {
  canUserMutateProvider,
  canUserSeeProvider,
  getProviderById,
  updateProviderRow,
} from '@/lib/db/providers';
import { providers as providerClasses } from '@/lib/models/providers';
import { createProviderInstance } from '@/lib/models/base/provider';

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = await params;

    const existing = getProviderById(id);
    if (!existing) {
      return Response.json({ message: 'Not found.' }, { status: 404 });
    }

    const admin = await isUserAdmin(userId);

    if (!canUserSeeProvider(existing, userId, admin)) {
      return ownershipErrorResponse();
    }

    if (!canUserMutateProvider(existing, userId, admin)) {
      return existing.userId === null
        ? adminRequiredResponse()
        : ownershipErrorResponse();
    }

    const Provider = providerClasses[existing.type];
    if (!Provider) {
      return Response.json(
        { models: [], added: 0 },
        { status: 200 },
      );
    }

    const instance = createProviderInstance(
      Provider,
      existing.id,
      existing.name,
      existing.config,
      existing.chatModels,
      existing.embeddingModels,
    );

    const remote = await instance.getDefaultModels();

    const existingChatKeys = new Set(existing.chatModels.map((m) => m.key));
    const existingEmbeddingKeys = new Set(
      existing.embeddingModels.map((m) => m.key),
    );

    let added = 0;

    const newChat = remote.chat.filter((m) => {
      if (existingChatKeys.has(m.key)) return false;
      added++;
      return true;
    });

    const newEmbedding = remote.embedding.filter((m) => {
      if (existingEmbeddingKeys.has(m.key)) return false;
      added++;
      return true;
    });

    if (added === 0) {
      return Response.json(
        {
          chatModels: existing.chatModels,
          embeddingModels: existing.embeddingModels,
          added: 0,
        },
        { status: 200 },
      );
    }

    const nextChatModels = [...existing.chatModels, ...newChat];
    const nextEmbeddingModels = [...existing.embeddingModels, ...newEmbedding];

    updateProviderRow(id, {
      chatModels: nextChatModels,
      embeddingModels: nextEmbeddingModels,
    });

    return Response.json(
      {
        chatModels: nextChatModels,
        embeddingModels: nextEmbeddingModels,
        added,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while syncing provider models', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
