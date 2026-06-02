import configManager from '@/lib/config';
import ModelRegistry from '@/lib/models/registry';
import { NextRequest, NextResponse } from 'next/server';
import {
  getCurrentUserId,
  MissingUserIdHeaderError,
  missingUserIdResponse,
} from '@/lib/db/scoped';

type SaveConfigBody = {
  key: string;
  value: string;
};

export const GET = async (req: NextRequest) => {
  try {
    const userId = getCurrentUserId(req);
    const values = configManager.getCurrentConfig();
    const fields = configManager.getUIConfigSections();

    // Providers no longer live in config.json (Phase 1 moved them to SQLite).
    // The pre-Phase 7 implementation mapped over values.modelProviders, which
    // was always undefined or empty after that migration, so the response
    // always shipped zero providers to the Settings dialogue. Build the list
    // straight from the registry so the panel sees the same data the
    // /api/providers endpoint does.
    const modelRegistry = new ModelRegistry(userId);
    const modelProviders = await modelRegistry.getActiveProviders();

    values.modelProviders = modelProviders.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type ?? '',
      scope: p.scope,
      chatModels: p.chatModels,
      embeddingModels: p.embeddingModels,
      // config is intentionally empty: this endpoint is not authorised to
      // leak api_key / secret material. Callers that need the raw config
      // for an edit flow must use /api/providers/[id]/secret instead.
      config: {},
      hash: '',
    }));

    return NextResponse.json({
      values,
      fields,
    });
  } catch (err) {
    if (err instanceof MissingUserIdHeaderError) return missingUserIdResponse();
    console.error('Error in getting config: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const body: SaveConfigBody = await req.json();

    if (!body.key || !body.value) {
      return Response.json(
        {
          message: 'Key and value are required.',
        },
        {
          status: 400,
        },
      );
    }

    configManager.updateConfig(body.key, body.value);

    return Response.json(
      {
        message: 'Config updated successfully.',
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error('Error in getting config: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
