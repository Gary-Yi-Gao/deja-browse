export const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema - pages table + FTS5',
    up: `
      CREATE TABLE IF NOT EXISTS pages (
        url           TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        summary       TEXT,
        keywords      TEXT,
        content_snippet TEXT,
        vector        BLOB,
        vector_norm   REAL,
        embedding_dim INTEGER,
        provider      TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pages_provider ON pages(provider);
      CREATE INDEX IF NOT EXISTS idx_pages_created ON pages(created_at DESC);
    `,
  },
];
