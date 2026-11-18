(() => {
  const $ = id => document.getElementById(id);
  const searchForm = $('mirror-search');
  const queryInput = $('mirror-query');
  const categoryInput = $('mirror-category');
  const filesInput = $('mirror-files');
  const results = $('mirror-results');
  if (!searchForm || !results) return;
  const params = new URLSearchParams(location.search);
  const requestedCategory = params.get('category') || '';
  if ([...categoryInput.options].some(option => option.value === requestedCategory)) categoryInput.value = requestedCategory;
  queryInput.value = params.get('q') || '';
  filesInput.checked = params.get('files') === '1';
  const detailId = params.get('id');
  let offset = 0;
  let hasMore = false;
  let busy = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dateLabel = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    return new Date(value).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
  };
  function collectionHref(id = '') {
    const next = new URLSearchParams();
    if (queryInput.value.trim()) next.set('q', queryInput.value.trim());
    if (categoryInput.value) next.set('category', categoryInput.value);
    if (filesInput.checked) next.set('files', '1');
    if (id) next.set('id', id);
    const encoded = next.toString();
    return '/mirror.html' + (encoded ? '?' + encoded : '');
  }
  function updateUrl(id = '') {
    history.replaceState(null, '', collectionHref(id));
  }
  function renderResults(items, append = false) {
    const html = items.map(item => {
      const id = /^[a-f0-9]{32}$/i.test(item.id || '') ? item.id : '';
      if (!id) return '';
      const category = item.metadata?.category || 'Student information';
      const date = dateLabel(item.publishedAt || item.modifiedAt);
      const detailUrl = escape(collectionHref(id));
      return `<article class="mirror-card"><a class="mirror-card-open" href="${detailUrl}"><span class="mirror-category">${escape(category)}</span><h2>${escape(item.title || 'Student information')}</h2><p>${escape(item.description || item.excerpt || '')}</p><span class="mirror-card-foot">${date ? `<time>${escape(date)}</time>` : '<span>Local collection</span>'}<span>${Number(item.assetCount) > 0 ? `${Number(item.assetCount)} file${Number(item.assetCount) === 1 ? '' : 's'} · ` : ''}Read collection →</span></span></a></article>`;
    }).join('');
    if (!append) results.innerHTML = html;
    else results.insertAdjacentHTML('beforeend', html);
    if (!results.children.length) {
      const title = filesInput.checked ? 'No matching files yet' : 'No matching content';
      const message = filesInput.checked
        ? 'Try a shorter course code or another phrase. Only files already indexed in the local collection can be downloaded.'
        : 'Try a different phrase or content type.';
      results.innerHTML = `<div class="mirror-empty"><h2>${title}</h2><p>${message}</p><a href="/mirror.html">Browse all local content →</a></div>`;
    }
  }
  async function load(append = false) {
    if (busy) return;
    busy = true;
    const query = queryInput.value.trim();
    const category = categoryInput.value;
    const filesOnly = filesInput.checked;
    $('mirror-clear').hidden = !query && !category && !filesOnly;
    const start = append ? offset : 0;
    if (!append) {
      offset = 0;
      results.replaceChildren();
      $('mirror-count').textContent = 'Searching the collection…';
    }
    const url = new URL('/api/content', location.origin);
    if (query) url.searchParams.set('q', query);
    if (category) url.searchParams.set('category', category);
    if (filesOnly) url.searchParams.set('files', '1');
    url.searchParams.set('limit', '24');
    url.searchParams.set('offset', String(start));
    try {
      const response = await fetch(url.pathname + url.search, {headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('Collection request failed');
      const payload = await response.json();
      if (!Array.isArray(payload.items)) throw new Error('Collection response is invalid');
      renderResults(payload.items, append);
      hasMore = Boolean(payload.hasMore);
      offset = Number.isInteger(payload.nextOffset) ? payload.nextOffset : start + payload.items.length;
      $('mirror-more').hidden = !hasMore;
      const total = start + payload.items.length;
      $('mirror-count').textContent = `${payload.items.length ? `${total}${hasMore ? '+' : ''}` : '0'} ${filesOnly ? 'downloadable file result' : 'result'}${total === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`;
      updateUrl();
    } catch {
      if (!append) results.replaceChildren();
      $('mirror-count').textContent = 'The collection could not be loaded right now.';
      $('mirror-more').hidden = true;
    } finally {
      busy = false;
    }
  }
  function renderDetail(document) {
    const id = /^[a-f0-9]{32}$/i.test(document.id || '') ? document.id : '';
    if (!id) throw new Error('Document is unavailable');
    $('mirror-intro').hidden = true;
    $('mirror-browser').hidden = true;
    const detail = $('mirror-detail');
    detail.hidden = false;
    const backLink = globalThis.document.querySelector('.mirror-back');
    if (backLink) backLink.href = collectionHref();
    globalThis.document.title = `${document.title || 'Collection item'} · Nounarchive`;
    $('detail-category').textContent = document.metadata?.category || 'Student information';
    $('detail-title').textContent = document.title || 'Student information';
    $('detail-description').textContent = document.description || '';
    const published = dateLabel(document.publishedAt);
    const modified = dateLabel(document.modifiedAt);
    $('detail-meta').textContent = [published ? `Published ${published}` : '', modified ? `Updated ${modified}` : ''].filter(Boolean).join(' · ');
    $('detail-content').textContent = document.content || '';
    const assets = Array.isArray(document.assets) ? document.assets.filter(asset => /^[a-f0-9]{32}$/i.test(asset.id || '')) : [];
    if (assets.length) {
      $('detail-assets').hidden = false;
      $('detail-asset-list').innerHTML = assets.map(asset => `<a class="mirror-asset" href="/api/content/assets/${encodeURIComponent(asset.id)}"><span aria-hidden="true">↓</span><span><strong>${escape(asset.fileName || 'Study file')}</strong><small>${escape(asset.contentType || 'Download')}${Number.isFinite(Number(asset.byteSize)) && Number(asset.byteSize) > 0 ? ` · ${(Number(asset.byteSize) / 1048576).toFixed(1)} MB` : ''}</small></span></a>`).join('');
    }
    updateUrl(id);
  }
  async function loadDetail(id) {
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      $('mirror-intro').hidden = true;
      $('mirror-browser').hidden = true;
      $('mirror-detail').hidden = false;
      $('detail-title').textContent = 'This collection item is unavailable.';
      return;
    }
    $('mirror-intro').hidden = true;
    $('mirror-browser').hidden = true;
    $('mirror-detail').hidden = false;
    try {
      const response = await fetch('/api/content/' + encodeURIComponent(id), {headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('Document request failed');
      renderDetail(await response.json());
    } catch {
      $('detail-title').textContent = 'This collection item is unavailable.';
      $('detail-description').textContent = '';
      $('detail-content').textContent = '';
    }
  }
  searchForm.addEventListener('submit', event => { event.preventDefault(); load(false); });
  categoryInput.addEventListener('change', () => load(false));
  filesInput.addEventListener('change', () => load(false));
  $('mirror-clear').addEventListener('click', () => { queryInput.value = ''; categoryInput.value = ''; filesInput.checked = false; load(false); });
  $('mirror-more').addEventListener('click', () => { if (hasMore) load(true); });
  if (detailId) loadDetail(detailId);
  else load(false);
})();
