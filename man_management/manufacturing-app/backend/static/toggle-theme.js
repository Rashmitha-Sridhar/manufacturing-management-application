// toggle-theme.js - non-invasive theme toggle
(function(){
  const root = document.documentElement;
  const key = 'mfg_theme_pref';
  function applyTheme(t){
    if(t) root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
  }
  // read saved
  let pref = null;
  try{ pref = localStorage.getItem(key);}catch(e){}
  applyTheme(pref);
  // if a token exists mark body auth (helps backend pages)
  try{ if(localStorage.getItem('token')) document.body.setAttribute('data-auth','true'); }catch(e){}
  // listen for cross-tab login/logout changes
  window.addEventListener('storage', (ev)=>{
    if(ev.key==='token'){
      try{ if(localStorage.getItem('token')) document.body.setAttribute('data-auth','true'); else document.body.removeAttribute('data-auth'); }catch(e){}
      // attempt to attach toggle if now logged in
      if(localStorage.getItem('token')) maybeAttach();
    }
  });

  // create control only if user is authenticated (token in localStorage)
  function maybeAttach(){
    const token = localStorage.getItem('token');
    if(!token) return;
    if(document.querySelector('.theme-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.title = 'Toggle light / dark theme';
    btn.innerHTML = `<span class="dot"></span><span class="label">Theme</span>`;
    btn.addEventListener('click', ()=>{
      const current = document.documentElement.getAttribute('data-theme');
      const next = (current === 'light') ? 'dark' : 'light';
      applyTheme(next === 'dark' ? null : 'light');
      try{ localStorage.setItem(key, next==='dark' ? '' : 'light'); }catch(e){}
    });
    document.body.appendChild(btn);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ maybeAttach(); });
  } else maybeAttach();
})();
