import {
  getCurrentUserId,
  isUserAdmin,
  MissingUserIdHeaderError,
  missingUserIdResponse,
  ownershipErrorResponse,
} from '@/lib/db/scoped';
import {
  canUserSeeProvider,
  getProviderById,
} from '@/lib/db/providers';
import { providers as providerClasses } from '@/lib/models/providers';
import { Model } from '@/lib/models/types';
import { createProviderInstance } from '@/lib/models/base/provider';

// Returns remote models available from a provider endpoint (e.g. /v1/models
// for OpenAI-compatible APIs). If the provider class does not return any
// remote models, the list is empty and the caller should fall back to
// manual entry.
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(_req);
    const { id } = await params;

    const existing = getProviderById(id);
    if (!existing) {
      return Response.json({ message: 'Not found.' }, { status: 404 });
    }

    const admin = await isUserAdmin(userId);
    if (!canUserSeeProvider(existing, userId, admin)) {
      return ownershipErrorResponse();
    }

    const Provider = providerClasses[existing.type];
    if (!Provider) {
      return Response.json({ models: [], supportsFetch: false });
    }

    const instance = createProviderInstance(
      Provider,
      existing.id,
      existing.name,
      existing.config,
      existing.chatModels,
      existing.embeddingModels,
    );

    const modelList = await instance.getDefaultModels();

    return Response.json({ models: modelList });
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    // Failing to fetch remote models is not an error worth bubbling to the
    // client — the dialog should degrade to manual entry.
    return Response.json({
      models: { chat: [], embedding: [] },
    });
  }
};
