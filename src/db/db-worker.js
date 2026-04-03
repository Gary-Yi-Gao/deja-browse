import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const DB_NAME = 'deja-browse.sqlite3';
const SQLITE_WASM_URL = `${self.location.origin}/vendor/sqlite3.wasm`;

let db = null;

const SCHEMA_SQL = `
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
`;

async function initDb() {
  let sqlite3 = null;
  let initErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const wasmBinary = await loadSqliteWasmBinary();
      sqlite3 = await sqlite3InitModule({
        print: console.log,
        printErr: console.error,
        locateFile: (name) => (name.endsWith('.wasm') ? SQLITE_WASM_URL : name),
        wasmBinary,
      });
      initErr = null;
      break;
    } catch (e) {
      initErr = e;
      const msg = String(e?.message || e);
      const retryable = msg.includes('CompileError') || msg.includes('BufferSource argument is empty');
      if (!retryable || attempt === 2) break;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!sqlite3) throw initErr || new Error('sqlite init failed');

  if (sqlite3.installOpfsSAHPoolVfs) {
    try {
      const poolVfs = await sqlite3.installOpfsSAHPoolVfs({ name: 'opfs-deja', initialCapacity: 6 });
      db = new poolVfs.OpfsSAHPoolDb(`/${DB_NAME}`);
    } catch {
      db = new sqlite3.oo1.DB(`/${DB_NAME}`, 'ct');
    }
  } else {
    db = new sqlite3.oo1.DB(`/${DB_NAME}`, 'ct');
  }

  db.exec('PRAGMA journal_mode=WAL');
  db.exec(SCHEMA_SQL);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
        url, title, keywords, content_snippet,
        content='pages', content_rowid='rowid',
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
    `);
  } catch (e) {
    console.warn('FTS5 setup warning:', e.message);
  }

  return { ok: true };
}

async function loadSqliteWasmBinary() {
  const response = await fetch(SQLITE_WASM_URL, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`sqlite wasm fetch failed: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  if (!bytes || bytes.byteLength === 0) {
    throw new Error(`sqlite wasm bytes empty: ${SQLITE_WASM_URL}`);
  }
  return bytes;
}

function insertPage(page) {
  const vec = page.vector ? new Float32Array(page.vector) : null;
  const norm = vec
    ? Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
    : null;

  const vectorBlob = vec ? new Uint8Array(vec.buffer) : null;

  db.exec({
    sql: `INSERT OR REPLACE INTO pages
          (url, title, summary, keywords, content_snippet, vector, vector_norm, embedding_dim, provider, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bind: [
      page.url,
      page.title,
      page.summary || null,
      page.keywords || null,
      page.contentSnippet || null,
      vectorBlob,
      norm,
      page.embeddingDim || null,
      page.provider || null,
      page.createdAt || Date.now(),
      Date.now(),
    ],
  });

  return { ok: true };
}

function pageExists(url) {
  const rows = [];
  db.exec({ sql: 'SELECT 1 FROM pages WHERE url = ?', bind: [url], callback: r => rows.push(r) });
  return rows.length > 0;
}

function searchByText(keyword, limit = 6) {
  if (!keyword || !keyword.trim()) return [];

  const tokens = keyword.trim().split(/\s+/).map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  const results = [];

  try {
    db.exec({
      sql: `SELECT p.url, p.title, p.summary, p.keywords, p.content_snippet, p.created_at
            FROM pages_fts fts
            JOIN pages p ON fts.rowid = p.rowid
            WHERE pages_fts MATCH ?
            ORDER BY rank
            LIMIT ?`,
      bind: [tokens, limit],
      callback: (row) => {
        results.push({
          url: row[0], title: row[1], summary: row[2],
          keywords: row[3], contentSnippet: row[4], createdAt: row[5],
        });
      },
    });
  } catch {
    db.exec({
      sql: `SELECT url, title, summary, keywords, content_snippet, created_at
            FROM pages
            WHERE title LIKE ? OR keywords LIKE ? OR content_snippet LIKE ? OR url LIKE ?
            ORDER BY updated_at DESC
            LIMIT ?`,
      bind: [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit],
      callback: (row) => {
        results.push({
          url: row[0], title: row[1], summary: row[2],
          keywords: row[3], contentSnippet: row[4], createdAt: row[5],
        });
      },
    });
  }

  return results;
}

function searchByVector(queryVecArray, provider, topK = 10) {
  const queryVec = queryVecArray instanceof Float32Array ? queryVecArray : new Float32Array(queryVecArray);
  const queryNorm = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0));
  if (queryNorm === 0) return [];

  const rows = [];
  db.exec({
    sql: 'SELECT url, title, summary, vector, vector_norm FROM pages WHERE provider = ? AND vector IS NOT NULL',
    bind: [provider],
    callback: (row) => rows.push({ url: row[0], title: row[1], summary: row[2], vector: row[3], vectorNorm: row[4] }),
  });

  const scored = [];
  for (const row of rows) {
    if (!row.vector || !row.vectorNorm) continue;
    const storedVec = new Float32Array(
      row.vector instanceof ArrayBuffer ? row.vector : row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength),
    );
    if (storedVec.length !== queryVec.length) continue;

    let dot = 0;
    for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * storedVec[i];
    const score = dot / (queryNorm * row.vectorNorm);

    scored.push({ url: row.url, title: row.title, summary: row.summary, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

function updateVector(url, vectorArray, embeddingDim, provider) {
  const vector = vectorArray instanceof Float32Array ? vectorArray : new Float32Array(vectorArray);
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));

  db.exec({
    sql: 'UPDATE pages SET vector = ?, vector_norm = ?, embedding_dim = ?, provider = ?, updated_at = ? WHERE url = ?',
    bind: [new Uint8Array(vector.buffer), norm, embeddingDim, provider, Date.now(), url],
  });

  return { ok: true };
}

function deletePage(url) {
  db.exec({ sql: 'DELETE FROM pages WHERE url = ?', bind: [url] });
  return { ok: true };
}

function getStats() {
  let totalPages = 0;
  let withVector = 0;
  const providers = {};

  db.exec({
    sql: 'SELECT COUNT(*) FROM pages',
    callback: (row) => { totalPages = row[0]; },
  });

  db.exec({
    sql: 'SELECT COUNT(*) FROM pages WHERE vector IS NOT NULL',
    callback: (row) => { withVector = row[0]; },
  });

  db.exec({
    sql: 'SELECT provider, COUNT(*) FROM pages GROUP BY provider',
    callback: (row) => { providers[row[0] || 'none'] = row[1]; },
  });

  return { totalPages, withVector, providers };
}

function exportDatabase() {
  const bytes = db.sqlite3.capi.sqlite3_js_db_export(db.pointer);
  return Array.from(bytes);
}

function importDatabase(bytes, format, strategy) {
  if (format === 'sqlite') {
    db.close();
    db = null;
    // Re-init with imported data will be handled by re-creating the db
    // For now, we export/re-import by re-initializing
    return initDb().then(() => {
      db.exec('DELETE FROM pages');
      // Load the imported database
      const importDb = new db.sqlite3.oo1.DB();
      importDb.onclose = { after: () => {} };
      const rc = db.sqlite3.capi.sqlite3_deserialize(
        importDb.pointer, 'main', bytes, bytes.byteLength, bytes.byteLength,
        0,
      );
      if (rc !== 0) throw new Error('Failed to deserialize database');

      const rows = [];
      importDb.exec({
        sql: 'SELECT url, title, summary, keywords, content_snippet, vector, vector_norm, embedding_dim, provider, created_at, updated_at FROM pages',
        callback: (row) => rows.push(row),
      });
      importDb.close();

      db.exec('BEGIN TRANSACTION');
      try {
        for (const row of rows) {
          const sql = strategy === 'merge'
            ? 'INSERT OR IGNORE INTO pages (url,title,summary,keywords,content_snippet,vector,vector_norm,embedding_dim,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
            : 'INSERT OR REPLACE INTO pages (url,title,summary,keywords,content_snippet,vector,vector_norm,embedding_dim,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
          db.exec({ sql, bind: row });
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      return { ok: true, count: rows.length };
    });
  }

  // JSON format
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(data)) throw new Error('Invalid JSON format');

  if (strategy === 'overwrite') {
    db.exec('DELETE FROM pages');
  }

  db.exec('BEGIN TRANSACTION');
  let count = 0;
  try {
    for (const item of data) {
      let vectorBlob = null;
      if (item.vector && typeof item.vector === 'string') {
        const binary = atob(item.vector);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        vectorBlob = bytes;
      }

      const sql = strategy === 'merge'
        ? 'INSERT OR IGNORE INTO pages (url,title,summary,keywords,content_snippet,vector,vector_norm,embedding_dim,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        : 'INSERT OR REPLACE INTO pages (url,title,summary,keywords,content_snippet,vector,vector_norm,embedding_dim,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)';

      db.exec({
        sql,
        bind: [
          item.url, item.title, item.summary, item.keywords,
          item.content_snippet || item.contentSnippet,
          vectorBlob, item.vector_norm || item.vectorNorm,
          item.embedding_dim || item.embeddingDim,
          item.provider, item.created_at || item.createdAt,
          item.updated_at || item.updatedAt || Date.now(),
        ],
      });
      count++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true, count };
}

function getAllPages(limit = 1000, offset = 0) {
  const results = [];
  db.exec({
    sql: 'SELECT url, title, summary, keywords, content_snippet, provider, created_at, updated_at FROM pages ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    bind: [limit, offset],
    callback: (row) => {
      results.push({
        url: row[0], title: row[1], summary: row[2], keywords: row[3],
        contentSnippet: row[4], provider: row[5], createdAt: row[6], updatedAt: row[7],
      });
    },
  });
  return results;
}

function getPagesWithoutVector(limit = 50) {
  const results = [];
  db.exec({
    sql: 'SELECT url, title, content_snippet FROM pages WHERE vector IS NULL LIMIT ?',
    bind: [limit],
    callback: (row) => results.push({ url: row[0], title: row[1], contentSnippet: row[2] }),
  });
  return results;
}

const handlers = {
  ping: () => ({ ok: true }),
  init: () => initDb(),
  insertPage: ({ page }) => insertPage(page),
  pageExists: ({ url }) => pageExists(url),
  searchByText: ({ keyword, limit }) => searchByText(keyword, limit),
  searchByVector: ({ queryVector, provider, topK }) => searchByVector(queryVector, provider, topK),
  updateVector: ({ url, vector, embeddingDim, provider }) => updateVector(url, vector, embeddingDim, provider),
  deletePage: ({ url }) => deletePage(url),
  getStats: () => getStats(),
  exportDatabase: () => exportDatabase(),
  importDatabase: ({ bytes, format, strategy }) => importDatabase(bytes, format, strategy),
  getAllPages: ({ limit, offset }) => getAllPages(limit, offset),
  getPagesWithoutVector: ({ limit }) => getPagesWithoutVector(limit),
};

self.onmessage = async (e) => {
  const { id, action, payload } = e.data;
  try {
    if (!db && action !== 'init' && action !== 'ping') {
      await initDb();
    }
    const handler = handlers[action];
    if (!handler) throw new Error(`Unknown action: ${action}`);
    const result = await handler(payload || {});
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
