import { formatDate } from './utils.js';

export async function exportAsSqlite(dbClient) {
  const bytes = await dbClient.exportDatabase();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url,
    filename: `deja-browse-backup-${formatDate(new Date())}.sqlite3`,
    saveAs: true,
  });

  URL.revokeObjectURL(url);
}

export async function exportAsJson(dbClient) {
  const pages = await dbClient.getAllPages(100000, 0);
  const json = JSON.stringify(pages, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url,
    filename: `deja-browse-backup-${formatDate(new Date())}.json`,
    saveAs: true,
  });

  URL.revokeObjectURL(url);
}

export async function importFromFile(dbClient, file, strategy = 'merge') {
  const buffer = await file.arrayBuffer();
  const header = new Uint8Array(buffer.slice(0, 16));
  const headerStr = Array.from(header).map(b => String.fromCharCode(b)).join('');
  const isSqlite = headerStr.startsWith('SQLite format 3');

  return dbClient.importDatabase(
    new Uint8Array(buffer),
    isSqlite ? 'sqlite' : 'json',
    strategy,
  );
}
