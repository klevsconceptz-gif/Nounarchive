(() => {
  const root=document.getElementById('story-content');
  const id=new URLSearchParams(location.search).get('id');
  const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  if(!root)return;
  if(!id){root.innerHTML='<div class="tool-empty"><h1>Update not found</h1><p>Choose a story from the local news archive.</p></div>';return;}
  fetch('/api/archive').then(response=>{if(!response.ok)throw Error();return response.json();}).then(archive=>{
    const item=(archive.items||[]).find(entry=>String(entry.id)===id);
    if(!item)throw Error('not-found');
    document.title=`${item.title} · Nounarchive`;
    let saved=new Set();try{saved=new Set(JSON.parse(localStorage.getItem('nounarchive-saved')||'[]'));}catch{}
    const date=item.publishedAt?new Date(item.publishedAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'Date unavailable';
    root.innerHTML=`<div class="eyebrow">${escape(item.category||'COMMUNITY UPDATE')}</div><h1>${escape(item.title)}</h1><div class="story-meta"><time ${item.publishedAt?`datetime="${escape(item.publishedAt)}"`:''}>${escape(date)}</time><span>Summary</span></div><p class="article-summary">${escape(item.excerpt||'A short summary is not available for this update.')}</p><div class="article-text"><p>This item is saved in the Nounarchive reading archive. Browse related updates or open the student tools below.</p></div><button id="save-story" class="secondary" type="button" aria-pressed="${saved.has(item.id)}">${saved.has(item.id)?'Saved to reading list':'Save this update'}</button>`;
    document.getElementById('save-story').addEventListener('click',()=>{
      let current=new Set();try{current=new Set(JSON.parse(localStorage.getItem('nounarchive-saved')||'[]'));}catch{}
      if(current.has(item.id))current.delete(item.id);else current.add(item.id);
      try{localStorage.setItem('nounarchive-saved',JSON.stringify([...current]));}catch{document.getElementById('save-story').textContent='Could not save on this device';return;}
      const button=document.getElementById('save-story');button.setAttribute('aria-pressed',String(current.has(item.id)));button.textContent=current.has(item.id)?'Saved to reading list':'Save this update';
    });
  }).catch(()=>{root.innerHTML='<div class="tool-empty"><h1>Update unavailable</h1><p>This summary could not be loaded. Return to the local archive and try another update.</p><a href="/#feed">Browse updates →</a></div>';});
})();
