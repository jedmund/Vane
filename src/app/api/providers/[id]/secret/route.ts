import { NextRequest } from 'next/server';
import {
  getCurrentUserId,
  isUserAdmin,
  MissingUserIdHeaderError,
  missingUserIdResponse,
  ownershipErrorResponse,
} from '@/lib/db/scoped';
import { getProviderById } from '@/lib/db/providers';

// The one endpoint that intentionally returns the raw provider config blob
// including api_key. Used by the Settings UI to populate the edit form on
// reveal. Access: owner of a personal row OR admin (admins can reveal any
// row, including instance and other users' personal rows, because they
// already have full mutation rights via PATCH/DELETE).
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = await params;

    if (!id) {
      return Response.json(
        { message: 'Provider ID is required.' },
        { status: 400 },
      );
    }

    const existing = getProviderById(id);
    if (!existing) {
      return Response.json({ message: 'Not found.' }, { status: 404 });
    }

    const admin = await isUserAdmin(userId);

    // Read access is narrower here than for the list endpoint: instance
    // visibility is NOT enough to reveal the secret. Non-admin callers can
    // only reveal their own personal rows. Otherwise every authenticated
    // user could pull the admin-managed shared api_key.
    const isOwner = existing.userId !== null && existing.userId === userId;
    if (!admin && !isOwner) {
      return ownershipErrorResponse();
    }

    return Response.json(
      {
        provider: {
          id: existing.id,
          name: existing.name,
          type: existing.type,
          scope: existing.userId === null ? 'instance' : 'personal',
          config: existing.config,
          chatModels: existing.chatModels,
          embeddingModels: existing.embeddingModels,
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while revealing provider secret', err?.message);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
