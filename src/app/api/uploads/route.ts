import { NextResponse } from 'next/server';
import ModelRegistry from '@/lib/models/registry';
import UploadManager from '@/lib/uploads/manager';
import {
  getCurrentUserId,
  MissingUserIdHeaderError,
  missingUserIdResponse,
} from '@/lib/db/scoped';

export async function POST(req: Request) {
  try {
    const userId = getCurrentUserId(req);
    const formData = await req.formData();

    const files = formData.getAll('files') as File[];
    const embeddingModel = formData.get('embedding_model_key') as string;
    const embeddingModelProvider = formData.get('embedding_model_provider_id') as string;

    if (!embeddingModel || !embeddingModelProvider) {
      return NextResponse.json(
        { message: 'Missing embedding model or provider' },
        { status: 400 },
      );
    }

    const registry = new ModelRegistry(userId);

    const model = await registry.loadEmbeddingModel(embeddingModelProvider, embeddingModel);
    
    const uploadManager = new UploadManager({
      embeddingModel: model,
    })

    const processedFiles = await uploadManager.processFiles(files);

    return NextResponse.json({
      files: processedFiles,
    });
  } catch (error) {
    if (error instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
}
