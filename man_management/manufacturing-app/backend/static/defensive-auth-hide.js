// defensive-auth-hide for backend pages
(function(){
  function protect(){
    try{
      const token = localStorage.getItem('token');
      if(!token){
        document.documentElement.setAttribute('data-auth','false');
        const nav = document.querySelector('header nav'); if(nav) nav.style.display='none';
        const main = document.querySelector('main');
        if(main){ Array.from(main.children).forEach(ch=>{ if(ch.id !== 'authControls') ch.style.display='none'; }); }
      } else { document.documentElement.setAttribute('data-auth','true'); }
    }catch(e){}
  }
  protect();
  document.addEventListener('DOMContentLoaded', protect);
  window.addEventListener('storage', (ev)=>{ if(ev.key==='token') protect(); });
})();
