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

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  url,
  title,
  keywords,
  content_snippet,
  content='pages',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, url, title, keywords, content_snippet)
  VALUES (new.rowid, new.url, new.title, new.keywords, new.content_snippet);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, url, title, keywords, content_snippet)
  VALUES ('delete', old.rowid, old.url, old.title, old.keywords, old.content_snippet);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, url, title, keywords, content_snippet)
  VALUES ('delete', old.rowid, old.url, old.title, old.keywords, old.content_snippet);
  INSERT INTO pages_fts(rowid, url, title, keywords, content_snippet)
  VALUES (new.rowid, new.url, new.title, new.keywords, new.content_snippet);
END;
