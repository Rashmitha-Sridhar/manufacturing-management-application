// auto-inject-theme.js - ensures theme CSS and toggle script are present
(function(){
  function addLink(){
    if(!document.querySelector('link[data-theme-css]')){
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = '/static/styles.css';
      l.setAttribute('data-theme-css','1');
      document.head.appendChild(l);
    }
  }
  function addToggle(){
    if(!document.querySelector('script[data-theme-toggle]')){
      const s = document.createElement('script');
      s.src = '/static/toggle-theme.js';
      s.setAttribute('data-theme-toggle','1');
      document.body.appendChild(s);
    }
  }
  function addDefensive(){
    if(!document.querySelector('script[data-defensive-auth]')){
      const s = document.createElement('script');
      s.src = '/static/defensive-auth-hide.js';
      s.setAttribute('data-defensive-auth','1');
      document.body.appendChild(s);
    }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{addLink(); addToggle(); addDefensive();});
  } else { addLink(); addToggle(); addDefensive(); }
})();
