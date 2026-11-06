(() => {
 const form=document.getElementById('hub-search');
 form?.addEventListener('submit',event=>{
 event.preventDefault();const search=document.getElementById('search');
 search.value=document.getElementById('hub-query').value;
 search.dispatchEvent(new Event('input',{bubbles:true}));
 document.getElementById('feed').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 search.focus({preventScroll:true});
 });
 // Also support browsers without native exclusive details groups.
 const groups=[...document.querySelectorAll('.directory-groups details')];
 for(const group of groups)group.addEventListener('toggle',()=>{
 if(group.open)for(const other of groups)if(other!==group)other.open=false;
 });
})();
