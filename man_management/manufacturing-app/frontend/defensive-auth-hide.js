// defensive-auth-hide.js - hide most UI until authenticated
(function(){
  function protect(){
    try{
      const token = localStorage.getItem('token');
      if(!token){
        document.documentElement.setAttribute('data-auth','false');
        // hide nav and main > :not(#authControls) using inline styles as a last-resort
        const nav = document.querySelector('header nav'); if(nav) nav.style.display='none';
        const main = document.querySelector('main');
        if(main){
          Array.from(main.children).forEach(ch=>{ if(ch.id !== 'authControls') ch.style.display='none'; });
        }
      } else {
        document.documentElement.setAttribute('data-auth','true');
      }
    }catch(e){ /* silent */ }
  }
  // run early
  protect();
  // run again on DOMContentLoaded and storage events (login in another tab)
  document.addEventListener('DOMContentLoaded', protect);
  window.addEventListener('storage', (ev)=>{ if(ev.key==='token') protect(); });
})();
