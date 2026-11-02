const $=id=>document.getElementById(id);
let csrf='', posts=[], selected=null, dirty=false, busy=false;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'success';}
function showLogin(){csrf='';posts=[];selected=null;$('post-form').reset();$('post-list').replaceChildren();$('workspace').hidden=true;$('login-panel').hidden=false;}
async function api(path,options={}){
 const response=await fetch('/api/admin'+path,{...options,headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1','X-CSRF-Token':csrf,...options.headers}});
 const body=await response.json();if(!response.ok){if(response.status===401 && path!=='/login')showLogin();throw Error(body.error||'Request failed.');}return body;
}
function renderList(){
 const published=posts.filter(p=>p.status==='published').length;
 $('stats').innerHTML=`<div class="desk-stat"><b>${posts.length}</b>Total updates</div><div class="desk-stat"><b>${published}</b>Published</div><div class="desk-stat"><b>${posts.length-published}</b>Drafts</div>`;
 const filtered=posts.filter(p=>p.title.toLowerCase().includes($('post-search').value.toLowerCase()));
 $('post-list').innerHTML=filtered.map(p=>`<button class="post-entry ${p.id===selected?'selected':''}" data-id="${p.id}"><strong>${escape(p.title)}</strong><span>${p.status==='published'?'● Published':'○ Draft'} · ${new Date(p.updatedAt).toLocaleDateString()}</span></button>`).join('')||'<p class="setup-note">No updates here yet. Your next post starts on the right.</p>';
}
function updateButton(){$('save-post').textContent=$('visibility').value==='published'?'Publish update ↗':'Save draft';}
function edit(post=null){selected=post?.id||null;dirty=false;$('title').value=post?.title||'';$('content').value=post?.content||'';$('excerpt').value=post?.excerpt||'';$('category').value=post?.category||'Campus news';$('visibility').value=post?.status||'draft';$('editor-label').textContent=post?'EDIT UPDATE':'NEW UPDATE';$('editor-heading').textContent=post?'Make it even better.':'A story worth sharing.';$('delete-post').hidden=!post;$('preview').hidden=true;updateButton();renderList();}
function canLeave(){return !busy&&(!dirty||confirm('Discard your unsaved changes?'));}
async function enter(){posts=await api('/posts');$('login-panel').hidden=true;$('workspace').hidden=false;edit();}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const result=await api('/login',{method:'POST',body:JSON.stringify({password:$('password').value})});csrf=result.csrf;$('password').value='';await enter();message('Signed in. Welcome to your editorial desk.');}catch(e){message(e.message,true);}finally{button.disabled=false;}});
$('post-form').addEventListener('input',()=>{dirty=true;});$('visibility').addEventListener('change',()=>{dirty=true;updateButton();});
$('post-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;$('save-post').disabled=true;try{const fields={title:$('title').value,content:$('content').value,excerpt:$('excerpt').value,category:$('category').value,status:$('visibility').value};const post=await api(selected?'/posts/'+selected:'/posts',{method:selected?'PUT':'POST',body:JSON.stringify(fields)});posts=await api('/posts');edit(post);message(post.status==='published'?'Published! Your update is now visible on the website.':'Draft saved. Only the admin can see it.');}catch(e){message(e.message,true);}finally{busy=false;$('save-post').disabled=false;}});
$('post-list').addEventListener('click',e=>{const id=e.target.closest('[data-id]')?.dataset.id;if(id&&canLeave())edit(posts.find(p=>p.id===id));});
$('new-post').addEventListener('click',()=>{if(canLeave()){edit();$('title').focus();}});
$('post-search').addEventListener('input',renderList);
$('preview-button').addEventListener('click',()=>{$('preview-title').textContent=$('title').value||'Untitled update';$('preview-content').textContent=$('content').value;$('preview').hidden=false;$('preview').scrollIntoView({behavior:'smooth'});});
$('delete-post').addEventListener('click',async()=>{if(!selected||busy||!confirm('Permanently delete this post? It will also disappear from the public website.'))return;busy=true;try{await api('/posts/'+selected,{method:'DELETE'});posts=await api('/posts');edit();message('Post deleted.');}catch(e){message(e.message,true);}finally{busy=false;}});
$('logout').addEventListener('click',async()=>{if(!canLeave())return;try{await api('/logout',{method:'POST'});showLogin();dirty=false;message('Signed out securely.');}catch(e){message(e.message,true);}});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
(async()=>{try{const session=await api('/session');csrf=session.csrf;await enter();}catch{showLogin();}})();
