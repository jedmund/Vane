import searchImages from '@/lib/agents/media/image';
import ModelRegistry from '@/lib/models/registry';
import { ModelWithProvider } from '@/lib/models/types';
import {
  getCurrentUserId,
  MissingUserIdHeaderError,
  missingUserIdResponse,
} from '@/lib/db/scoped';

interface ImageSearchBody {
  query: string;
  chatHistory: any[];
  chatModel: ModelWithProvider;
}

export const POST = async (req: Request) => {
  try {
    const userId = getCurrentUserId(req);
    const body: ImageSearchBody = await req.json();

    const registry = new ModelRegistry(userId);

    const llm = await registry.loadChatModel(
      body.chatModel.providerId,
      body.chatModel.key,
    );

    const images = await searchImages(
      {
        chatHistory: body.chatHistory.map(([role, content]) => ({
          role: role === 'human' ? 'user' : 'assistant',
          content,
        })),
        query: body.query,
      },
      llm,
    );

    return Response.json({ images }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error(`An error occurred while searching images: ${err}`);
    return Response.json(
      { message: 'An error occurred while searching images' },
      { status: 500 },
    );
  }
};
