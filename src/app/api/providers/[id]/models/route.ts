import { Model } from '@/lib/models/types';
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

// Adds an operator-curated model entry to a provider. Provider mutation
// rules apply (admin always; non-admin only own personal rows).
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = await params;

    const body: Partial<Model> & { type: 'embedding' | 'chat' } =
      await req.json();

    if (!body.key || !body.name) {
      return Response.json(
        { message: 'Key and name must be provided' },
        { status: 400 },
      );
    }

    if (body.type !== 'chat' && body.type !== 'embedding') {
      return Response.json(
        { message: 'type must be "chat" or "embedding"' },
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

    const next: Model = { key: body.key, name: body.name };

    const field = body.type === 'chat' ? 'chatModels' : 'embeddingModels';
    const currentList =
      body.type === 'chat' ? existing.chatModels : existing.embeddingModels;

    // Idempotent on key: re-POSTing the same key replaces the previous
    // entry rather than duplicating it. Avoids two rows with the same key
    // and different names diverging in the UI.
    const filtered = currentList.filter((m) => m.key !== next.key);
    const nextList = [...filtered, next];

    updateProviderRow(id, { [field]: nextList } as any);

    return Response.json(
      { message: 'Model added successfully' },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while adding provider model', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

// Renames an existing model entry on a provider. The key and type identify
// which model to update; only the display name changes.
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = await params;

    const body: { key: string; name: string; type: 'embedding' | 'chat' } =
      await req.json();

    if (!body.key || !body.name) {
      return Response.json(
        { message: 'Key and name must be provided' },
        { status: 400 },
      );
    }

    if (body.type !== 'chat' && body.type !== 'embedding') {
      return Response.json(
        { message: 'type must be "chat" or "embedding"' },
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

    const field = body.type === 'chat' ? 'chatModels' : 'embeddingModels';
    const currentList =
      body.type === 'chat' ? existing.chatModels : existing.embeddingModels;

    const idx = currentList.findIndex((m) => m.key === body.key);
    if (idx === -1) {
      return Response.json({ message: 'Model not found.' }, { status: 404 });
    }

    const nextList = currentList.map((m) =>
      m.key === body.key ? { ...m, name: body.name } : m,
    );

    updateProviderRow(id, { [field]: nextList } as any);

    return Response.json(
      { message: 'Model renamed successfully' },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while renaming provider model', err);
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

    const body: { key: string; type: 'embedding' | 'chat' } = await req.json();

    if (!body.key) {
      return Response.json(
        { message: 'Key must be provided' },
        { status: 400 },
      );
    }

    if (body.type !== 'chat' && body.type !== 'embedding') {
      return Response.json(
        { message: 'type must be "chat" or "embedding"' },
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

    const field = body.type === 'chat' ? 'chatModels' : 'embeddingModels';
    const currentList =
      body.type === 'chat' ? existing.chatModels : existing.embeddingModels;
    const nextList = currentList.filter((m) => m.key !== body.key);

    updateProviderRow(id, { [field]: nextList } as any);

    return Response.json(
      { message: 'Model removed successfully' },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('An error occurred while deleting provider model', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
