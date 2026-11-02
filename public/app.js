const $ = id => document.getElementById(id);
let data = {items:[],sources:[],status:{}}, category = 'All updates', savedOnly = false, limit = 6;
let saved; try { saved = new Set(JSON.parse(localStorage.getItem('nounarchive-saved') || '[]')); } catch { saved = new Set(); }
const categories = ['All updates','Examinations','Academics','Admissions','Graduation','Campus news'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dateLabel = date => date ? new Date(date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'Date unavailable';
const art = {'Campus news':['The campus brief','✳'],'Examinations':['Ready. Set. Prepare.','▦'],'Admissions':['A new chapter.','↗'],'Academics':['Plan your next move.','◷'],'Graduation':['On to what’s next.','✦']};
function linkAttrs(i){ return i.source==='nounarchive'?'':'target="_blank" rel="noopener noreferrer"'; }
function metadata(i,publisher){return `<div class="story-meta"><time ${i.publishedAt?`datetime="${escape(i.publishedAt)}"`:''}>${dateLabel(i.publishedAt)}</time><span>Category: ${escape(i.category)}</span>${i.readingMinutes?`<span>${Number(i.readingMinutes)} min read</span>`:''}<span class="publisher">${escape(publisher?.name||i.source)}</span></div>`;}
function renderFeatured(){
 const latest=[...data.items].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
 const lead=latest[0];
 if(!lead){$('featured').innerHTML='<div class="feature-loading">Your community updates will appear here as articles become available.</div>';$('recent').textContent='No articles available yet.';return;}
 const publisher=data.sources.find(s=>s.id===lead.source);
 $('featured').innerHTML=`<article class="lead-story"><div class="lead-art" aria-hidden="true"><span class="feature-kicker">THE COMMUNITY BRIEF</span><strong>Every update.<br>A step forward.</strong><small>NEWS · LEARNING · COMMUNITY</small><span class="feature-symbol">✳</span></div><div class="lead-copy"><div class="eyebrow">LATEST IN THE ARCHIVE</div><h2><a href="${escape(lead.url)}" ${linkAttrs(lead)}>${escape(lead.title)}</a></h2>${metadata(lead,publisher)}<p>${escape(lead.excerpt)}</p><a class="read-more" href="${escape(lead.url)}" ${linkAttrs(lead)}>Read the full update →</a></div></article>`;
 $('recent').innerHTML=latest.slice(1,5).map(i=>`<a class="recent-item" href="${escape(i.url)}" ${linkAttrs(i)}><small>${dateLabel(i.publishedAt)} · ${escape(i.category)}</small><strong>${escape(i.title)}</strong></a>`).join('');
}
function render() {
 $('saved-count').textContent = saved.size;
 $('saved-nav').classList.toggle('active',savedOnly);
 $('categories').innerHTML = categories.map(c=>`<button class="chip ${category===c?'selected':''}" data-category="${c}" aria-pressed="${category===c}">${c}</button>`).join('');
 const q = $('search').value.toLowerCase().trim(); const source = $('source').value;
 let items = data.items.filter(i=>(category==='All updates'||i.category===category)&&(source==='all'||i.source===source)&&(!savedOnly||saved.has(i.id))&&`${i.title} ${i.excerpt} ${i.category}`.toLowerCase().includes(q));
 items.sort((a,b)=>$('sort').value==='title'?a.title.localeCompare(b.title):$('sort').value==='oldest'?(Date.parse(a.publishedAt)||0)-(Date.parse(b.publishedAt)||0):(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
 $('result-count').innerHTML=`<strong>${items.length}</strong> ${savedOnly?'saved ':''}update${items.length===1?'':'s'}${q?' matching your search':''}`;
 $('clear').hidden = !(q||source!=='all'||category!=='All updates'||savedOnly);
 $('cards').innerHTML = items.slice(0,limit).map(i=>{
 const publisher = data.sources.find(s=>s.id===i.source); const visual = art[i.category] || art['Campus news'];
 return `<article class="card"><div class="card-art ${escape(i.category.toLowerCase().replaceAll(' ','-'))}" aria-hidden="true"><span class="art-corner">NOUNARCHIVE</span><span class="art-word">${visual[0]}</span><span class="art-icon">${visual[1]}</span></div><div class="card-body"><h3><a href="${escape(i.url)}" ${linkAttrs(i)}>${escape(i.title)}</a></h3>${metadata(i,publisher)}<p>${escape(i.excerpt||'Read the full update on the original publisher’s website.')}</p><div class="card-bottom"><a href="${escape(i.url)}" ${linkAttrs(i)}>${i.source==='nounarchive'?'Read more':'Read more at source'} →</a><button class="save ${saved.has(i.id)?'saved':''}" data-save="${i.id}" aria-pressed="${saved.has(i.id)}" aria-label="${saved.has(i.id)?'Unsave':'Save'} ${escape(i.title)}" title="${saved.has(i.id)?'Remove bookmark':'Save update'}">${saved.has(i.id)?'▣':'▱'}</button></div></div></article>`;
 }).join('') || `<div class="empty"><h3>${savedOnly?'Your reading list starts here.':'No updates found.'}</h3><p>${savedOnly?'Use the bookmark button on any update to save it on this device.':'Try another search or source. If this source has not synced yet, check its status below.'}</p></div>`;
 $('load-more').hidden = items.length<=limit;
}
function renderStatus(){
 const statuses=Object.values(data.status); const successes=statuses.filter(s=>s.state==='ok');
 $('notice').textContent=successes.length===3?'All three sources synced successfully. Articles link to the original publishers.':`Showing available archive records. Initial snapshot: ${data.snapshotAt || 'not available'}. ${successes.length}/3 sources synced successfully. A failed check does not mean a source has no news. Automatic checks run hourly while the server is running.`;
 $('source-status').innerHTML=data.sources.map(s=>{ const st=data.status[s.id]||(s.id==='nounarchive'?{state:'ok',message:'Original posts from the Nounarchive editorial team.'}:{});return `<div class="source-health"><b>${escape(s.name)} · ${st.state==='ok'?'Connected':st.state==='error'?'Unavailable':'Snapshot'}</b><span class="${st.state==='error'?'error':''}">${escape(st.message||'Not checked yet')}</span><span>${st.checkedAt?'Checked '+new Date(st.checkedAt).toLocaleString():'Awaiting live check'}</span>${st.lastSuccess?`<span>Last success: ${new Date(st.lastSuccess).toLocaleString()}</span>`:''}</div>`;}).join('');
}
async function load(){try{const response=await fetch('/api/archive');if(!response.ok)throw Error();data=await response.json();render();renderFeatured();renderStatus();}catch{$('notice').textContent='The archive is temporarily unavailable. Please try again shortly.';$('result-count').textContent='Connection unavailable';$('featured').textContent='The latest story is temporarily unavailable.';}}
$('categories').addEventListener('click',e=>{if(e.target.dataset.category){category=e.target.dataset.category;limit=6;render();}});
$('cards').addEventListener('click',e=>{const id=e.target.closest('[data-save]')?.dataset.save;if(!id)return;saved.has(id)?saved.delete(id):saved.add(id);try{localStorage.setItem('nounarchive-saved',JSON.stringify([...saved]));}catch{$('notice').textContent='Bookmarks cannot be persisted because browser storage is unavailable.';}render();});
for(const id of ['search','source','sort']) $(id).addEventListener(id==='search'?'input':'change',()=>{limit=6;render();});
$('saved-nav').addEventListener('click',()=>{savedOnly=!savedOnly;limit=6;render();$('feed').scrollIntoView({behavior:'smooth'});});
$('clear').addEventListener('click',()=>{category='All updates';savedOnly=false;$('source').value='all';$('search').value='';limit=6;render();});
$('load-more').addEventListener('click',()=>{limit+=6;render();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}});
load();setInterval(load,60000);
