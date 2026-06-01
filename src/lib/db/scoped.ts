import { and, eq } from 'drizzle-orm';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';

// Single source of truth for per-user data scoping. Routes import these
// helpers instead of building their own WHERE clauses; if a future query
// pattern needs to bypass user scope (admin tooling, batch jobs) it does so
// by NOT calling these, which makes the bypass visible in code review.

export const USER_ID_HEADER = 'x-vane-user-id';

// The proxy (src/proxy.ts) sets x-vane-user-id on every request that passes
// the auth gate. If the header is missing here, the proxy is misconfigured
// or has been bypassed; that is a 500 condition, not 401. Distinguishing the
// two matters: a 401 would tell the client to send the user through the
// login flow again, which would not fix a server-side wiring bug.
export class MissingUserIdHeaderError extends Error {
  constructor() {
    super(
      'Missing x-vane-user-id header. The proxy should have set this; the request likely bypassed it.',
    );
    this.name = 'MissingUserIdHeaderError';
  }
}

// Thrown by assertUserOwnsChat. Routes catch and convert to 403. Named
// distinctly so a future "not found at all" case (chatId genuinely absent
// from the database) can be distinguished by the catch site if needed.
export class OwnershipError extends Error {
  constructor(public readonly chatId: string) {
    super(`User does not own chat ${chatId}`);
    this.name = 'OwnershipError';
  }
}

export function getCurrentUserId(req: Request): string {
  const userId = req.headers.get(USER_ID_HEADER);
  if (!userId) throw new MissingUserIdHeaderError();
  return userId;
}

// Returns the chat row if owned by userId, else null. Single SQL query.
// We do not differentiate "chat does not exist" from "chat exists but is
// owned by someone else" here; both return null, and the caller decides
// what status code to emit. The locked policy is 403 for both, so the
// distinction does not matter at the route layer.
export async function getUserChat(userId: string, chatId: string) {
  return db.query.chats
    .findFirst({
      where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    })
    .execute();
}

// Throws OwnershipError when the chat is not owned (or does not exist).
// Used by mutating handlers that need to fail-closed before touching the
// database. Read paths typically prefer getUserChat + null check.
export async function assertUserOwnsChat(userId: string, chatId: string) {
  const chat = await getUserChat(userId, chatId);
  if (!chat) throw new OwnershipError(chatId);
  return chat;
}

// Helper for route catch blocks. Centralizes the status-code mapping so all
// routes return the same shape for the same condition.
export function ownershipErrorResponse() {
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

export function missingUserIdResponse() {
  return Response.json(
    { error: 'server_misconfigured' },
    { status: 500 },
  );
}
