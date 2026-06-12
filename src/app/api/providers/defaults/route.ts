import { NextRequest } from 'next/server';
import {
  adminRequiredResponse,
  getCurrentUserId,
  isUserAdmin,
  MissingUserIdHeaderError,
  missingUserIdResponse,
} from '@/lib/db/scoped';
import {
  loadDefaults,
  setSetting,
  InstanceDefaults,
} from '@/lib/db/settings';

export const GET = async (_req: NextRequest) => {
  try {
    getCurrentUserId(_req);
    return Response.json(loadDefaults(), { status: 200 });
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

export const PUT = async (req: NextRequest) => {
  try {
    const userId = getCurrentUserId(req);
    const admin = await isUserAdmin(userId);
    if (!admin) return adminRequiredResponse();

    const body: Partial<InstanceDefaults> = await req.json();

    if (body.chatProviderId !== undefined) {
      setSetting('default_chat_provider_id', body.chatProviderId ?? '');
    }
    if (body.chatModelKey !== undefined) {
      setSetting('default_chat_model_key', body.chatModelKey ?? '');
    }
    if (body.embeddingProviderId !== undefined) {
      setSetting('default_embedding_provider_id', body.embeddingProviderId ?? '');
    }
    if (body.embeddingModelKey !== undefined) {
      setSetting('default_embedding_model_key', body.embeddingModelKey ?? '');
    }

    return Response.json(loadDefaults(), { status: 200 });
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
