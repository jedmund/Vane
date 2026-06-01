import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getCurrentUserId,
  getUserChat,
  MissingUserIdHeaderError,
  missingUserIdResponse,
  ownershipErrorResponse,
} from '@/lib/db/scoped';

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = await params;

    // Locked decision: 403, not 404. Returning 404 here would leak whether
    // the chat id exists under a different account; an attacker could
    // enumerate chat ids and tell "this exists but is not yours" apart
    // from "this does not exist".
    const chat = await getUserChat(userId, id);
    if (!chat) return ownershipErrorResponse();

    // Messages are reached only through an already-scoped chat. We do not
    // re-check ownership on the messages query because the chat ownership
    // above is the trust boundary; messages.chatId is a foreign key into
    // an already-validated chat row.
    const chatMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, id),
    });

    return Response.json(
      {
        chat,
        messages: chatMessages,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) {
      return missingUserIdResponse();
    }
    console.error('Error in getting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = await params;

    const chat = await getUserChat(userId, id);
    if (!chat) return ownershipErrorResponse();

    await db.delete(chats).where(eq(chats.id, id)).execute();
    await db.delete(messages).where(eq(messages.chatId, id)).execute();

    return Response.json(
      { message: 'Chat deleted successfully' },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) {
      return missingUserIdResponse();
    }
    console.error('Error in deleting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
