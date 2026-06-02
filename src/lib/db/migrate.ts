import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ulid } from 'ulid';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const dbPath = path.join(DATA_DIR, './data/db.sqlite');
const configPath = path.join(DATA_DIR, './data/config.json');

const db = new Database(dbPath);

const migrationsFolder = path.join(DATA_DIR, 'drizzle');

db.exec(`
  CREATE TABLE IF NOT EXISTS ran_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    run_on DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function sanitizeSql(content: string) {
  const statements = content
    .split(/--> statement-breakpoint/g)
    .map((stmt) =>
      stmt
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('-->'))
        .join('\n')
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);

  return statements;
}

fs.readdirSync(migrationsFolder)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .forEach((file) => {
    const filePath = path.join(migrationsFolder, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    const statements = sanitizeSql(content);

    const migrationName = file.split('_')[0] || file;

    const already = db
      .prepare('SELECT 1 FROM ran_migrations WHERE name = ?')
      .get(migrationName);

    if (already) {
      console.log(`Skipping already-applied migration: ${file}`);
      return;
    }

    try {
      if (migrationName === '0001') {
        const messages = db
          .prepare(
            'SELECT id, type, metadata, content, chatId, messageId FROM messages',
          )
          .all();

        db.exec(`
                    CREATE TABLE IF NOT EXISTS messages_with_sources (
                        id INTEGER PRIMARY KEY,
                        type TEXT NOT NULL,
                        chatId TEXT NOT NULL,
                        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        messageId TEXT NOT NULL,
                        content TEXT,
                        sources TEXT DEFAULT '[]'
                    );
                `);

        const insertMessage = db.prepare(`
                    INSERT INTO messages_with_sources (type, chatId, createdAt, messageId, content, sources)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);

        messages.forEach((msg: any) => {
          while (typeof msg.metadata === 'string') {
            msg.metadata = JSON.parse(msg.metadata || '{}');
          }
          if (msg.type === 'user') {
            insertMessage.run(
              'user',
              msg.chatId,
              msg.metadata['createdAt'],
              msg.messageId,
              msg.content,
              '[]',
            );
          } else if (msg.type === 'assistant') {
            insertMessage.run(
              'assistant',
              msg.chatId,
              msg.metadata['createdAt'],
              msg.messageId,
              msg.content,
              '[]',
            );
            const sources = msg.metadata['sources'] || '[]';
            if (sources && sources.length > 0) {
              insertMessage.run(
                'source',
                msg.chatId,
                msg.metadata['createdAt'],
                `${msg.messageId}-source`,
                '',
                JSON.stringify(sources),
              );
            }
          }
        });

        db.exec('DROP TABLE messages;');
        db.exec('ALTER TABLE messages_with_sources RENAME TO messages;');
      } else if (migrationName === '0002') {
        /* Migrate chat */
        db.exec(`
          CREATE TABLE IF NOT EXISTS chats_new (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            sources TEXT DEFAULT '[]',
            files TEXT DEFAULT '[]'
          );
        `);

        const chats = db
          .prepare('SELECT id, title, createdAt, files FROM chats')
          .all();

        const insertChat = db.prepare(`
            INSERT INTO chats_new (id, title, createdAt, sources, files)
            VALUES (?, ?, ?, ?, ?)
          `);

        chats.forEach((chat: any) => {
          let files = chat.files;
          while (typeof files === 'string') {
            files = JSON.parse(files || '[]');
          }

          insertChat.run(
            chat.id,
            chat.title,
            chat.createdAt,
            '["web"]',
            JSON.stringify(files),
          );
        });

        db.exec('DROP TABLE chats;');
        db.exec('ALTER TABLE chats_new RENAME TO chats;');

        /* Migrate messages */

        db.exec(`
          CREATE TABLE IF NOT EXISTS messages_new (
            id INTEGER PRIMARY KEY,
            messageId TEXT NOT NULL,
            chatId TEXT NOT NULL,
            backendId TEXT NOT NULL,
            query TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            responseBlocks TEXT DEFAULT '[]',
            status TEXT DEFAULT 'answering'
          );
        `);

        const messages = db
          .prepare(
            'SELECT id, messageId, chatId, type, content, createdAt, sources FROM messages ORDER BY id ASC',
          )
          .all();

        const insertMessage = db.prepare(`
            INSERT INTO messages_new (messageId, chatId, backendId, query, createdAt, responseBlocks, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

        let currentMessageData: {
          sources?: any[];
          response?: string;
          query?: string;
          messageId?: string;
          chatId?: string;
          createdAt?: string;
        } = {};
        let lastCompleted = true;

        messages.forEach((msg: any) => {
          if (msg.type === 'user' && lastCompleted) {
            currentMessageData = {};
            currentMessageData.messageId = msg.messageId;
            currentMessageData.chatId = msg.chatId;
            currentMessageData.query = msg.content;
            currentMessageData.createdAt = msg.createdAt;
            lastCompleted = false;
          } else if (msg.type === 'source' && !lastCompleted) {
            let sources = msg.sources;

            while (typeof sources === 'string') {
              sources = JSON.parse(sources || '[]');
            }

            currentMessageData.sources = sources;
          } else if (msg.type === 'assistant' && !lastCompleted) {
            currentMessageData.response = msg.content;
            insertMessage.run(
              currentMessageData.messageId,
              currentMessageData.chatId,
              `${currentMessageData.messageId}-backend`,
              currentMessageData.query,
              currentMessageData.createdAt,
              JSON.stringify([
                {
                  id: crypto.randomUUID(),
                  type: 'text',
                  data: currentMessageData.response || '',
                },
                ...(currentMessageData.sources &&
                currentMessageData.sources.length > 0
                  ? [
                      {
                        id: crypto.randomUUID(),
                        type: 'source',
                        data: currentMessageData.sources,
                      },
                    ]
                  : []),
              ]),
              'completed',
            );

            lastCompleted = true;
          } else if (msg.type === 'user' && !lastCompleted) {
            /* Message wasn't completed so we'll just create the record with empty response */
            insertMessage.run(
              currentMessageData.messageId,
              currentMessageData.chatId,
              `${currentMessageData.messageId}-backend`,
              currentMessageData.query,
              currentMessageData.createdAt,
              JSON.stringify([
                {
                  id: crypto.randomUUID(),
                  type: 'text',
                  data: '',
                },
                ...(currentMessageData.sources &&
                currentMessageData.sources.length > 0
                  ? [
                      {
                        id: crypto.randomUUID(),
                        type: 'source',
                        data: currentMessageData.sources,
                      },
                    ]
                  : []),
              ]),
              'completed',
            );

            lastCompleted = true;
          }
        });

        db.exec('DROP TABLE messages;');
        db.exec('ALTER TABLE messages_new RENAME TO messages;');
      } else if (migrationName === '0004') {
        // Schema changes are SQL; the modelProviders backfill from
        // data/config.json is data-driven so it lives in JS, gated by the
        // same ran_migrations row that gates the SQL. Idempotent because
        // re-running this migration is skipped at the top of the loop.
        statements.forEach((stmt) => {
          if (stmt.trim()) {
            db.exec(stmt);
          }
        });

        if (fs.existsSync(configPath)) {
          try {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const cfg = JSON.parse(raw);
            const providers = Array.isArray(cfg?.modelProviders)
              ? cfg.modelProviders
              : [];

            const insertProvider = db.prepare(
              'INSERT INTO providers (id, userId, type, name, config, createdAt) VALUES (?, NULL, ?, ?, ?, ?)',
            );
            const now = new Date().toISOString();

            providers.forEach((p: any) => {
              const cfgBlob = {
                ...(p.config ?? {}),
                chatModels: Array.isArray(p.chatModels) ? p.chatModels : [],
                embeddingModels: Array.isArray(p.embeddingModels)
                  ? p.embeddingModels
                  : [],
              };
              insertProvider.run(
                ulid(),
                p.type ?? 'unknown',
                p.name ?? p.type ?? 'Unnamed',
                JSON.stringify(cfgBlob),
                now,
              );
            });

            console.log(
              `Seeded ${providers.length} instance provider(s) from config.json`,
            );
          } catch (err) {
            console.error(
              'Failed to seed instance providers from config.json:',
              err,
            );
            throw err;
          }
        }
      } else {
        // Execute each statement separately
        statements.forEach((stmt) => {
          if (stmt.trim()) {
            db.exec(stmt);
          }
        });
      }

      db.prepare('INSERT OR IGNORE INTO ran_migrations (name) VALUES (?)').run(
        migrationName,
      );
      console.log(`Applied migration: ${file}`);
    } catch (err) {
      console.error(`Failed to apply migration ${file}:`, err);
      throw err;
    }
  });
