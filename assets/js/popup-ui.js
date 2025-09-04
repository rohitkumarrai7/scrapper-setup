// Popup UI logic (MV3-safe, no inline scripts)
(function(){
  const $ = (s)=>document.querySelector(s);
  const statusEl = document.getElementById('status');
  const errEl = document.getElementById('error');
  const btnEl = document.getElementById('scrapeBtn');
  const nameEl = document.getElementById('scraped-name');
  const headlineEl = document.getElementById('scraped-headline');
  const rawWrap = document.getElementById('rawWrap');
  const rawEl = document.getElementById('raw');
  const urlEl = document.getElementById('field-url');
  const contactEl = document.getElementById('field-contact');
  const tsEl = document.getElementById('field-top-skills');
  const aboutEl = document.getElementById('field-about');
  const expEl = document.getElementById('list-experience');
  const eduEl = document.getElementById('list-education');
  const certEl = document.getElementById('list-certifications');

  function setStatus(txt, ok){
    if (!statusEl) return;
    statusEl.textContent = txt || '';
    if (ok){
      statusEl.classList.remove('error');
    } else {
      statusEl.classList.add('error');
    }
  }
  function showError(msg){ 
    if (errEl){ 
      errEl.textContent = msg; 
      errEl.style.display = 'block'; 
    }
    setStatus('Error', false);
  }
  function clearError(){ 
    if (errEl){ 
      errEl.style.display='none'; 
      errEl.textContent=''; 
    }
  }

  async function getActiveTab(){
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    return tabs[0];
  }
  function isLinkedIn(url){ 
    return /^https:\/\/.*linkedin\.com\//.test(url||''); 
  }

  async function ping(tabId){
    try{ 
      const r = await chrome.tabs.sendMessage(tabId, { type:'PING' }); 
      return r?.ok; 
    }catch{ 
      return false; 
    }
  }

  async function trigger(tabId){
    clearError();
    if (btnEl) btnEl.disabled = true; 
    setStatus('Scraping…');
    try{
      const resp = await chrome.tabs.sendMessage(tabId, { type:'TRIGGER_SCRAPE' });
      if (!resp?.ok) throw new Error(resp?.error || 'No data, open a LinkedIn profile and try again');
      const data = resp.data || {};
      const payload = data;
      const basic = payload.basic || {};
      const normalized = payload.normalized || {
        linkedinUrl: payload.url || '',
        name: basic.name || '',
        title: basic.headline || '',
        contactInfo: payload.contact || { emails: [], phones: [], websites: [], location: '' },
        topSkills: Array.isArray(payload.topSkills) ? payload.topSkills.map(s=> typeof s==='string'?s: s?.name).filter(Boolean).slice(0,10) : [],
        aboutSummary: payload.summary || '',
        experience: Array.isArray(payload.experience) ? payload.experience.map(e=>({ company: e.company||'', designation: e.title||'', dates: e.dates||'' })) : [],
        education: Array.isArray(payload.education) ? payload.education.map(ed=>({ college: ed.college||'', degree: ed.degree||'', dates: ed.dates||'' })) : [],
        certifications: Array.isArray(payload.licenses) ? payload.licenses.map(l=>({ name: l.name||'', authority: l.issuer||'', date: l.dates||'' })) : [],
      };
      renderNormalized(normalized);
      if (nameEl) nameEl.textContent = normalized.name || basic.name || '';
      if (headlineEl) headlineEl.textContent = normalized.title || basic.headline || '';
      if (rawEl) rawEl.textContent = JSON.stringify(payload, null, 2);
      setStatus('Done', true);
    }catch(e){
      showError(e.message||String(e));
      setStatus('Failed');
    }finally{ 
      if (btnEl) btnEl.disabled = false; 
    }
  }

  function renderNormalized(n){
    if (urlEl){ 
      urlEl.textContent = n.linkedinUrl || ''; 
      urlEl.setAttribute('href', n.linkedinUrl || '#'); 
    }
    if (contactEl){
      const parts = [];
      if (n.contactInfo?.emails?.length) parts.push(`Emails: ${n.contactInfo.emails.join(', ')}`);
      if (n.contactInfo?.phones?.length) parts.push(`Phones: ${n.contactInfo.phones.join(', ')}`);
      if (n.contactInfo?.websites?.length) parts.push(`Sites: ${n.contactInfo.websites.join(', ')}`);
      if (n.contactInfo?.location) parts.push(`Location: ${n.contactInfo.location}`);
      contactEl.textContent = parts.join('  |  ');
    }
    if (tsEl){ 
      tsEl.textContent = (n.topSkills||[]).join(', '); 
    }
    if (aboutEl){ 
      aboutEl.textContent = n.aboutSummary || ''; 
    }
    if (expEl){
      expEl.innerHTML = '';
      (n.experience||[]).forEach(e=>{
        const li = document.createElement('li');
        li.textContent = [e.company, e.designation, e.dates].filter(Boolean).join(' — ');
        expEl.appendChild(li);
      });
    }
    if (eduEl){
      eduEl.innerHTML = '';
      (n.education||[]).forEach(ed=>{
        const li = document.createElement('li');
        li.textContent = [ed.college, ed.degree, ed.dates].filter(Boolean).join(' — ');
        eduEl.appendChild(li);
      });
    }
    if (certEl){
      certEl.innerHTML = '';
      (n.certifications||[]).forEach(c=>{
        const li = document.createElement('li');
        li.textContent = [c.name, c.authority, c.date].filter(Boolean).join(' — ');
        certEl.appendChild(li);
      });
    }
  }

  async function init(){
    const tab = await getActiveTab();
    if (!tab){ 
      setStatus('No active tab'); 
      return; 
    }
    if (!isLinkedIn(tab.url)){
      setStatus('Open a LinkedIn profile and try again');
      if (btnEl) btnEl.disabled = true; 
      return;
    }
    setStatus('Checking content…');
    const ok = await ping(tab.id);
    if (!ok){
      setStatus('Preparing content…');
      try{ 
        await chrome.scripting.executeScript({ target:{ tabId: tab.id }, files: ['content.js'] }); 
      }catch{}
    }
    if (btnEl){ 
      btnEl.disabled = false; 
      btnEl.onclick = ()=>trigger(tab.id); 
    }
    setStatus('Ready', true);
    // auto-trigger once
    trigger(tab.id);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
