(() => {
 const cards = document.getElementById('resource-cards');
 if (!cards) return;
 const search = document.getElementById('resource-search');
 const category = document.getElementById('resource-category');
 const count = document.getElementById('resource-count');
 const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const parameters=new URLSearchParams(location.search);
 if(search)search.value=parameters.get('q')||'';
 if(category&&[...category.options].some(option=>option.value===parameters.get('category')))category.value=parameters.get('category');
 let resources = [];
 function render() {
  const query = (search?.value || '').trim().toLowerCase();
  const filtered = resources.filter(item => (!category || category.value === 'all' || item.category === category.value) && `${item.title} ${item.description}`.toLowerCase().includes(query));
  const limit = Number(cards.dataset.limit) || filtered.length;
  if (count) count.textContent = `${filtered.length} resource${filtered.length === 1 ? '' : 's'} available`;
  cards.innerHTML = filtered.slice(0, limit).map(item => `<article class="resource-card"><span class="resource-meta">${escape(item.category)}</span><h3>${escape(item.title)}</h3><p>${escape(String(item.description || '').replace(/(?:the )?provider[’']s /gi, '').replace(/^Visit /, 'Explore '))}</p></article>`).join('') || '<div class="empty"><h3>No resources found.</h3><p>Try another search or category.</p></div>';
 }
 search?.addEventListener('input', render);
 category?.addEventListener('change', render);
 fetch('/resources.json').then(response => { if (!response.ok) throw Error(); return response.json(); }).then(items => {
  if (!Array.isArray(items)) throw Error();
  // Origin URLs remain in the stored records, but never become navigation targets.
  resources = items.filter(item => item && typeof item.title === 'string');
  render();
 }).catch(() => { cards.innerHTML = '<div class="empty"><h3>Resources are temporarily unavailable.</h3><p>Please try again shortly.</p></div>'; if (count) count.textContent = 'Unable to load resources.'; });
})();
