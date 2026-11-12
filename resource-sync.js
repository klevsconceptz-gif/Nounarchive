import { collectResources, resourceSources } from './aggregator.js';

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href.toLowerCase();
  } catch {
    return '';
  }
}

function mergeResource(previous, incoming, checkedAt) {
  return {
    ...previous,
    ...incoming,
    id: previous?.id || incoming.id,
    firstSeenAt: previous?.firstSeenAt || checkedAt,
    lastSeenAt: checkedAt
  };
}

// Add newly discovered resource listings without deleting older records. A
// provider outage therefore cannot empty the directory or erase its history.
export async function refreshResourceArchive(archive, collector = collectResources, clock = () => new Date().toISOString()) {
  const items = new Map((archive.items || []).map(item => [item.id, item]));
  const byUrl = new Map([...items.values()].map(item => [normalizedUrl(item.url), item]));
  const status = { ...(archive.status || {}) };

  for (const source of resourceSources) {
    const checkedAt = clock();
    try {
      const incoming = await collector(source);
      if (!incoming.length) throw new Error('No resource listings found.');
      for (const entry of incoming) {
        const previous = items.get(entry.id) || byUrl.get(normalizedUrl(entry.url));
        const merged = mergeResource(previous, entry, checkedAt);
        items.set(merged.id, merged);
        byUrl.set(normalizedUrl(merged.url), merged);
      }
      status[source.id] = {
        state: 'ok',
        checkedAt,
        lastSuccess: checkedAt,
        message: `${incoming.length} resources found`
      };
    } catch (error) {
      status[source.id] = {
        ...(status[source.id] || {}),
        state: 'error',
        checkedAt,
        message: String(error?.message || 'Resource refresh failed').slice(0, 180)
      };
    }
  }

  return { ...archive, items: [...items.values()], status };
}

export { mergeResource };
