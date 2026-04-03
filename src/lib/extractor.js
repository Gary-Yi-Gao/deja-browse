import { Readability } from '@mozilla/readability';

export function extractContent(doc, maxLength = 2000) {
  let readableDoc = null;
  try {
    const html = doc.documentElement?.outerHTML || '';
    if (html) {
      readableDoc = new DOMParser().parseFromString(html, 'text/html');
    }
  } catch {
    readableDoc = null;
  }

  let article;
  try {
    if (readableDoc) {
      const reader = new Readability(readableDoc);
      article = reader.parse();
    } else {
      article = null;
    }
  } catch {
    article = null;
  }

  const title = article?.title || doc.title || '';
  let textContent = article?.textContent || '';
  if (!textContent) {
    // Fallback for pages where Readability cannot parse.
    textContent = doc.body?.innerText || doc.documentElement?.innerText || '';
  }
  if (textContent.length > maxLength) {
    textContent = textContent.slice(0, maxLength);
  }

  const metaDesc = doc.querySelector('meta[name="description"]')?.content || '';
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3'))
    .map(h => h.textContent?.trim())
    .filter(Boolean)
    .slice(0, 10);

  const keywords = [
    ...headings,
    ...(metaDesc ? [metaDesc] : []),
  ].join(', ');

  const contentSnippet = textContent.slice(0, 500);

  return {
    title,
    textContent,
    keywords,
    contentSnippet,
  };
}
