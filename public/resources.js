(() => {
  const cards = document.getElementById('resource-cards');
  if (!cards) return;
  const search = document.getElementById('resource-search');
  const category = document.getElementById('resource-category');
  const count = document.getElementById('resource-count');
  const refresh = document.getElementById('resource-refresh');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const slug = value => String(value || 'resource').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'resource';
  const parameters = new URLSearchParams(location.search);
  if (search) search.value = parameters.get('q') || '';
  const requestedCategory = parameters.get('category');
  if (category && requestedCategory && [...category.options].some(option => option.value === requestedCategory)) category.value = requestedCategory;
  let resources = [];

  function updateCategories() {
    if (!category) return;
    const selected = category.value || parameters.get('category') || 'all';
    const values = [...new Set(['all', ...resources.map(item => String(item.category || 'Student support'))])];
    const currentValues = new Set([...category.options].map(option => option.value));
    for (const value of values) {
      if (currentValues.has(value)) continue;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'all' ? 'All categories' : value;
      category.append(option);
    }
    category.value = values.includes(selected) ? selected : 'all';
  }

  function localHref(item) {
    const id = String(item.id || slug(item.title));
    return `/tool.html?id=${encodeURIComponent(id)}`;
  }

  function render() {
    const query = (search?.value || '').trim().toLowerCase();
    const filtered = resources.filter(item =>
      (!category || category.value === 'all' || item.category === category.value) &&
      `${item.title || ''} ${item.description || ''}`.toLowerCase().includes(query)
    );
    if (count) count.textContent = `${filtered.length} resource${filtered.length === 1 ? '' : 's'} available`;
    cards.innerHTML = filtered.map(item => {
      const title = escape(item.title || 'Student resource');
      const description = escape(item.description || 'Open this local student workspace.');
      const categoryName = escape(item.category || 'Student support');
      const href = escape(localHref(item));
      const action = item.localTool === 'news' ? 'Browse updates' : 'Open locally';
      return `<article class="resource-card"><span class="resource-meta">${categoryName}</span><h3>${title}</h3><p>${description}</p><a class="resource-link" href="${href}">${action} <span aria-hidden="true">→</span></a></article>`;
    }).join('') || '<div class="empty"><h3>No resources found.</h3><p>Try another search or category.</p></div>';
  }

  search?.addEventListener('input', render);
  category?.addEventListener('change', render);

  async function load() {
    let payload;
    try {
      const response = await fetch('/api/resources');
      if (!response.ok) throw Error('Resource API unavailable');
      payload = await response.json();
    } catch {
      const response = await fetch('/resources.json');
      if (!response.ok) throw Error('Resource directory unavailable');
      payload = await response.json();
    }
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items)) throw Error('Invalid resource directory');
    resources = items.filter(item => item && typeof item.title === 'string');
    updateCategories();
    render();
    if (refresh) {
      const latest = payload?.lastSuccess || Object.values(payload?.status || {}).map(status => status?.lastSuccess).filter(Boolean).sort().at(-1);
      refresh.textContent = latest ? `Last updated ${new Date(latest).toLocaleDateString('en-GB')}` : 'Daily refresh scheduled';
    }
  }

  load().catch(() => {
    cards.innerHTML = '<div class="empty"><h3>Resources are temporarily unavailable.</h3><p>Please try again shortly.</p></div>';
    if (count) count.textContent = 'Unable to load resources.';
    if (refresh) refresh.textContent = 'Daily refresh enabled';
  });
})();
