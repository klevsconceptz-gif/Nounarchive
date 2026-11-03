(() => {
 const cards = document.getElementById('resource-cards');
 if (!cards) return;
 const search = document.getElementById('resource-search');
 const category = document.getElementById('resource-category');
 const count = document.getElementById('resource-count');
 const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 let resources = [];
 function render() {
  const query = (search?.value || '').trim().toLowerCase();
  const filtered = resources.filter(item => (!category || category.value === 'all' || item.category === category.value) && `${item.title} ${item.description} ${item.source}`.toLowerCase().includes(query));
  const limit = Number(cards.dataset.limit) || filtered.length;
  if (count) count.textContent = `${filtered.length} resource${filtered.length === 1 ? '' : 's'} available`;
  cards.innerHTML = filtered.slice(0, limit).map(item => `<a class="resource-card" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer"><span class="resource-meta">${escape(item.category)}</span><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p><span class="resource-link">${escape(item.source)}<span aria-hidden="true">↗</span></span></a>`).join('') || '<div class="empty"><h3>No resources found.</h3><p>Try another search or category.</p></div>';
 }
 search?.addEventListener('input', render);
 category?.addEventListener('change', render);
 fetch('/resources.json').then(response => { if (!response.ok) throw Error(); return response.json(); }).then(items => {
  if (!Array.isArray(items)) throw Error();
  resources = items.filter(item => {
   try { return ['https://nounupdate.com','https://bbcnoun.com.ng','https://puredu.net'].includes(new URL(item.url).origin); } catch { return false; }
  });
  render();
 }).catch(() => { cards.innerHTML = '<div class="empty"><h3>Resources are temporarily unavailable.</h3><p>Please try again shortly.</p></div>'; if (count) count.textContent = 'Unable to load resources.'; });
})();
