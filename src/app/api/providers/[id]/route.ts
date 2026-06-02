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
  deleteProviderRow,
  getProviderById,
  updateProviderRow,
} from '@/lib/db/providers';

export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const body = await req.json();
    const { name, config } = body;
    const { id } = await params;

    if (!id) {
      return Response.json(
        { message: 'Provider ID is required.' },
        { status: 400 },
      );
    }

    // At least one mutable field must be present. Type is intentionally
    // immutable (locked decision); callers wanting a different type delete
    // and recreate.
    if (name === undefined && config === undefined) {
      return Response.json(
        { message: 'Nothing to update.' },
        { status: 400 },
      );
    }

    const existing = getProviderById(id);
    if (!existing) {
      return Response.json({ message: 'Not found.' }, { status: 404 });
    }

    const admin = await isUserAdmin(userId);

    // Even read visibility is gated: if the caller cannot see the row, we
    // return 403 (matching the chats precedent of not leaking that an id
    // exists for someone else).
    if (!canUserSeeProvider(existing, userId, admin)) {
      return ownershipErrorResponse();
    }

    if (!canUserMutateProvider(existing, userId, admin)) {
      return existing.userId === null
        ? adminRequiredResponse()
        : ownershipErrorResponse();
    }

    const updated = updateProviderRow(id, { name, config });
    if (!updated) {
      // Lost a race with a concurrent delete. Treat as not found rather
      // than 500 because the resource genuinely no longer exists.
      return Response.json({ message: 'Not found.' }, { status: 404 });
    }

    return Response.json(
      {
        provider: {
          id: updated.id,
          name: updated.name,
          type: updated.type,
          config: updated.config,
          scope: updated.userId === null ? 'instance' : 'personal',
          chatModels: updated.chatModels,
          embeddingModels: updated.embeddingModels,
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while updating provider', err?.message);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (
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

    if (!canUserSeeProvider(existing, userId, admin)) {
      return ownershipErrorResponse();
    }

    if (!canUserMutateProvider(existing, userId, admin)) {
      return existing.userId === null
        ? adminRequiredResponse()
        : ownershipErrorResponse();
    }

    deleteProviderRow(id);

    // chats has no providerId FK (see src/lib/db/schema.ts), so deleting
    // a provider cannot orphan a chat at the schema level. Chat messages
    // reference a provider implicitly through stored backendId fields,
    // but a missing provider just means the chat cannot be continued
    // until a new provider is configured; existing message content stays
    // intact.

    return Response.json(
      { message: 'Provider deleted successfully.' },
      { status: 200 },
    );
  } catch (err: any) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while deleting provider', err?.message);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
