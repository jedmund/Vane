import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import {
  getCurrentUserId,
  MissingUserIdHeaderError,
  missingUserIdResponse,
} from '@/lib/db/scoped';

export const GET = async (req: Request) => {
  try {
    const userId = getCurrentUserId(req);
    // Filter on userId at the SQL layer rather than fetching everything and
    // filtering in JS: keeps the row count bounded by the user's own data
    // even if the table grows. Order by createdAt desc so the newest chats
    // appear first; the prior implementation called .reverse() in JS which
    // assumed insertion order matched display order.
    const userChats = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.createdAt));
    return Response.json({ chats: userChats }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) {
      return missingUserIdResponse();
    }
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
