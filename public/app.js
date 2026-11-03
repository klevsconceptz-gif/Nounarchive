const $ = id => document.getElementById(id);
let data = {items:[],sources:[],status:{}}, category = 'All updates', savedOnly = false, limit = 6;
let saved; try { saved = new Set(JSON.parse(localStorage.getItem('nounarchive-saved') || '[]')); } catch { saved = new Set(); }
const categories = ['All updates','Examinations','Academics','Admissions','Graduation','Campus news'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dateLabel = date => date ? new Date(date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'Date unavailable';
const categoryPaths = {
 'Campus news':'<path d="m3 10 9-6 9 6M5 10v10m7-10v10m7-10v10M3 20h18M8 10h8"/>',
 'Examinations':'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h4"/>',
 'Academics':'<path d="M12 6C9 3 5 4 3 5v14c3-2 6-2 9 0 3-2 6-2 9 0V5c-3-1-6-2-9 1Zm0 0v13"/>',
 'Admissions':'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 5 2 2 4-4"/>',
 'Graduation':'<path d="m2 9 10-5 10 5-10 5-10-5Zm4 3v5c4 3 8 3 12 0v-5m4-3v8"/>'
};
function categoryIcon(category){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${categoryPaths[category] || categoryPaths['Campus news']}</svg>`;}
function internalHref(i){
 if(i.source!=='nounarchive')return null;
 try{const url=new URL(i.url,location.origin);return url.origin===location.origin&&!url.pathname.startsWith('//')?url.pathname+url.search+url.hash:null;}catch{return null;}
}
function storyTitle(i){const href=internalHref(i);return href?`<a href="${escape(href)}">${escape(i.title)}</a>`:escape(i.title);}
function readLink(i,label,classes=''){const href=internalHref(i);return href?`<a class="${classes}" href="${escape(href)}">${label}</a>`:'';}

function metadata(i){return `<div class="story-meta"><time ${i.publishedAt?`datetime="${escape(i.publishedAt)}"`:''}>${dateLabel(i.publishedAt)}</time><span>Category: ${escape(i.category)}</span>${i.readingMinutes?`<span>${Number(i.readingMinutes)} min read</span>`:''}</div>`;}
function renderFeatured(){
 const latest=[...data.items].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
 const lead=latest[0];
 if(!lead){$('featured').innerHTML='<div class="feature-loading">Your community updates will appear here as articles become available.</div>';$('recent').textContent='No articles available yet.';return;}
 $('featured').innerHTML=`<article class="lead-story"><div class="lead-art" aria-hidden="true"><span class="feature-kicker">THE COMMUNITY BRIEF</span><div class="feature-illustration">${categoryIcon(lead.category)}</div><strong>In the know.<br>Ready for what’s next.</strong><small>NEWS · LEARNING · COMMUNITY</small></div><div class="lead-copy"><div class="eyebrow">LATEST IN THE ARCHIVE</div><h2>${storyTitle(lead)}</h2>${metadata(lead)}<p>${escape(lead.excerpt)}</p>${readLink(lead,'Read the full update →','read-more')}</div></article>`;
 if ($('topic-stories')) {
 const selected=['Examinations','Academics','Admissions'].map(c=>latest.find(i=>i.category===c)).filter(Boolean);
 $('topic-stories').innerHTML=selected.map(i=>`<article class="topic-card"><div class="eyebrow">${escape(i.category)}</div><h3>${storyTitle(i)}</h3><p>${escape(i.excerpt)}</p><div class="topic-footer"><span>${dateLabel(i.publishedAt)}</span>${readLink(i,'Read story →')}</div></article>`).join('');
 }
 $('recent').innerHTML=latest.slice(1,5).map(i=>`<div class="recent-item"><small>${dateLabel(i.publishedAt)} · ${escape(i.category)}</small><strong>${storyTitle(i)}</strong></div>`).join('');
}
function render() {
 $('saved-count').textContent = saved.size;
 $('saved-nav').classList.toggle('active',savedOnly);
 $('categories').innerHTML = categories.map(c=>`<button class="chip ${category===c?'selected':''}" data-category="${c}" aria-pressed="${category===c}">${c}</button>`).join('');
 const q = $('search').value.toLowerCase().trim();
 let items = data.items.filter(i=>(category==='All updates'||i.category===category)&&(!savedOnly||saved.has(i.id))&&`${i.title} ${i.excerpt} ${i.category}`.toLowerCase().includes(q));
 items.sort((a,b)=>$('sort').value==='title'?a.title.localeCompare(b.title):$('sort').value==='oldest'?(Date.parse(a.publishedAt)||0)-(Date.parse(b.publishedAt)||0):(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
 $('result-count').innerHTML=`<strong>${items.length}</strong> ${savedOnly?'saved ':''}update${items.length===1?'':'s'}${q?' matching your search':''}`;
 $('clear').hidden = !(q||category!=='All updates'||savedOnly);
 $('cards').innerHTML = items.slice(0,limit).map(i=>{
 return `<article class="card"><div class="card-art ${escape(i.category.toLowerCase().replaceAll(' ','-'))}" aria-hidden="true"><span class="art-corner">NOUNARCHIVE</span><span class="art-icon">${categoryIcon(i.category)}</span><span class="art-word">${escape(i.category)}</span></div><div class="card-body"><h3>${storyTitle(i)}</h3>${metadata(i)}<p>${escape(i.excerpt||'No summary available.')}</p><div class="card-bottom">${readLink(i,'Read more →')}<button class="save ${saved.has(i.id)?'saved':''}" data-save="${i.id}" aria-pressed="${saved.has(i.id)}" aria-label="${saved.has(i.id)?'Unsave':'Save'} ${escape(i.title)}" title="${saved.has(i.id)?'Remove bookmark':'Save update'}">${saved.has(i.id)?'▣':'▱'}</button></div></div></article>`;
 }).join('') || `<div class="empty"><h3>${savedOnly?'Your reading list starts here.':'No updates found.'}</h3><p>${savedOnly?'Use the bookmark button on any update to save it on this device.':'Try another search or category.'}</p></div>`;
 $('load-more').hidden = items.length<=limit;
}
function renderStatus(){
 $('notice').textContent=data.syncing?'Updating the archive…':'';
}
async function load(){try{const response=await fetch('/api/archive');if(!response.ok)throw Error();data=await response.json();render();renderFeatured();renderStatus();}catch{$('notice').textContent='The archive is temporarily unavailable. Please try again shortly.';$('result-count').textContent='Connection unavailable';$('featured').textContent='The latest story is temporarily unavailable.';}}
$('categories').addEventListener('click',e=>{if(e.target.dataset.category){category=e.target.dataset.category;limit=6;render();}});
$('cards').addEventListener('click',e=>{const id=e.target.closest('[data-save]')?.dataset.save;if(!id)return;saved.has(id)?saved.delete(id):saved.add(id);try{localStorage.setItem('nounarchive-saved',JSON.stringify([...saved]));}catch{$('notice').textContent='Bookmarks cannot be persisted because browser storage is unavailable.';}render();});
for(const id of ['search','sort']) $(id).addEventListener(id==='search'?'input':'change',()=>{limit=6;render();});
$('saved-nav').addEventListener('click',()=>{savedOnly=!savedOnly;limit=6;render();$('feed').scrollIntoView({behavior:'smooth'});});
$('clear').addEventListener('click',()=>{category='All updates';savedOnly=false;$('search').value='';limit=6;render();});
$('load-more').addEventListener('click',()=>{limit+=6;render();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}});
load();setInterval(load,60000);
