// Singleton guard to prevent redeclaration on SPA navigations
if (window.__RCRM_CONTENT__){
  // Already initialized
} else {
  window.__RCRM_CONTENT__ = true;

  (function(){
    const LOG_PREFIX = '[RCRM-Content]';
    const STATE = {
      cache: {}, // per URL cache of last scrape
      currentUrl: location.href,
      scraping: false,
    };

    const cfg = {
      defaultTimeout: 8000,
      longTimeout: 15000,
      stepDelay: 200,
      skillsMaxExpandClicks: 3,
    };

    function log(...args){
      console.log(LOG_PREFIX, ...args);
    }

    function sleep(ms){
      return new Promise(res => setTimeout(res, ms));
    }

    function getRoot(){
      return document.querySelector('main') || document.querySelector('.scaffold-layout__main') || document.body;
    }

    // Platform/page guards
    function isLinkedInUrl(u){
      try {
        const url = new URL(u || location.href);
        return /(^|\.)linkedin\.com$/i.test(url.hostname);
      } catch { return false; }
    }

    function isProfileUrl(u){
      try {
        const url = new URL(u || location.href);
        if (!isLinkedInUrl(url.href)) return false;
        const p = url.pathname || '';
        // canonical profile paths look like /in/handle
        return /^\/in\/[^/]+\/?($|\?)/i.test(p) || /\/profile\//i.test(p);
      } catch { return false; }
    }

    // Block any anchor navigation while scraping to avoid SPA jumping to Advice pages
    function blockNavigation(){
      const handler = (e)=>{
        if (!STATE.scraping) return;
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (a){ e.preventDefault(); e.stopPropagation(); }
      };
      document.addEventListener('click', handler, true);
      return ()=>document.removeEventListener('click', handler, true);
    }

    // Try to bring a section into view to trigger lazy loading
    async function ensureInView(el){
      try { el?.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch{}
      await sleep(250);
    }

    // Find a section by id or heading text within root
    function findSectionByIdOrHeading(root, id, headingText){
      let sec = root.querySelector(`#${id}`)?.closest('section') || root.querySelector(`section#${id}`);
      if (sec) return sec;
      const sections = Array.from(root.querySelectorAll('section'));
      const found = sections.find(s=>{
        const h = s.querySelector('h2, h3, header');
        return h && contains(h, headingText);
      });
      return found || null;
    }

    async function waitForSelector(selector, { root = document, timeout = cfg.defaultTimeout, poll = 100 } = {}){
      const start = Date.now();
      let el = (root||getRoot()).querySelector(selector);
      while(!el){
        if (Date.now() - start > timeout) return null;
        await sleep(poll);
        el = (root||getRoot()).querySelector(selector);
      }
      return el;
    }

    function getText(el){ return (el?.textContent || '').trim(); }

    function safeClick(el){
      try {
        if (!el) return;
        // Avoid clicking anchors during scraping
        if (el.tagName === 'A') return;
        el.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
        if (typeof el.click === 'function') el.click();
      } catch(e){}
    }

    function cleanText(s){
      if (!s) return '';
      let t = s.replace(/\s+/g,' ').trim();
      // Remove UI labels we often catch
      t = t.replace(/^top skills\s*/i,'').replace(/^about\s*/i,'');
      // Collapse duplicated consecutive words (e.g., "FoundationsFoundations")
      t = t.replace(/(\b[\w'’()&/.-]+\b)\s*\1\b/gi, '$1');
      return t.trim();
    }

    async function withTimeout(promise, ms, label){
      let to;
      const timeout = new Promise((_, rej)=>{ to = setTimeout(()=>rej(new Error(`Timed out: ${label}`)), ms); });
      try { const r = await Promise.race([promise, timeout]); clearTimeout(to); return r; } finally { clearTimeout(to); }
    }

    async function expandSectionButtons(){
      const root = getRoot();
      const btns = Array.from(root.querySelectorAll('button')).filter(b=>{
        const t = b.getAttribute('aria-label') || b.textContent || '';
        const l = t.toLowerCase();
        return l.includes('show all') || l.includes('see more') || l.includes('show more');
      });
      btns.forEach(b=>{ safeClick(b); });
      await sleep(300);
    }

    function qsa(sel, root){ return Array.from((root||getRoot()).querySelectorAll(sel)); }

    function contains(node, text){ return node?.textContent?.toLowerCase().includes(text.toLowerCase()); }

    // Scrapers
    function scrapeBasic(){
      const root = getRoot();
      const name = getText(root.querySelector('h1.text-heading-xlarge, h1'));
      // Headline frequently at top card as text-body-medium break-words
      const headlineEl = root.querySelector('.pv-text-details__left-panel .text-body-medium.break-words, .pv-text-details__left-panel span, .text-body-medium.break-words');
      const headline = cleanText(getText(headlineEl));
      return { name, headline };
    }

    async function scrapeContactInfo(){
      const result = { emails: [], phones: [], websites: [], location: '' };
      const root = getRoot();
      const contactBtn = root.querySelector('button[aria-label*="Contact info" i], a[href*="overlay/contact-info"], a[data-control-name*="contact"]')
        || qsa('a', root).find(a=>contains(a, 'Contact info'));
      if (!contactBtn){ return result; }
      // Prefer clicking button; if anchor, open in-place by focusing modal trigger instead of navigating
      if (contactBtn.tagName === 'BUTTON') safeClick(contactBtn);
      else {
        contactBtn.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
      }
      const dialog = await waitForSelector('div[role="dialog"], .artdeco-modal', { root, timeout: cfg.longTimeout });
      if (!dialog){ return result; }
      // Emails
      qsa('a[href^="mailto:"]', dialog).forEach(a=>{ const v=a.getAttribute('href')?.replace('mailto:',''); if(v) result.emails.push(v); });
      // Phones
      qsa('span.t-14, span.t-12', dialog).forEach(s=>{ if(/\+?\d[\d\s().-]{6,}/.test(s.textContent)) result.phones.push(cleanText(getText(s))); });
      // Websites
      qsa('a[href^="http"]', dialog).forEach(a=>{ const href=a.getAttribute('href'); if(href && !href.includes('linkedin.com')) result.websites.push(href); });
      // Location (sometimes present in modal)
      const loc = qsa('section', dialog).find(sec=>contains(sec,'Location'));
      if (loc){ const v = cleanText(getText(loc.querySelector('.t-14, .t-12'))); if (v) result.location = v; }
      // Close modal gracefully if close is visible
      const closeBtn = dialog.querySelector('button[aria-label*="Dismiss" i], button.artdeco-modal__dismiss');
      if (closeBtn) safeClick(closeBtn);
      return result;
    }

    async function scrapeSummary(){
      const root = getRoot();
      const aboutSection = findSectionByIdOrHeading(root,'about','About');
      if (!aboutSection) return '';
      await ensureInView(aboutSection);
      const textEl = aboutSection.querySelector('div.inline-show-more-text, .display-flex.full-width, .pv-shared-text-with-see-more') || aboutSection;
      return cleanText(getText(textEl));
    }

    function normalizeText(s){ return (s||'').replace(/\s+/g,' ').trim(); }

    function scrapeExperience(){
      const experiences = [];
      const root = getRoot();
      const expSection = findSectionByIdOrHeading(root,'experience','Experience');
      if (!expSection) return experiences;
      // Ensure items are loaded
      expSection && (expSection.querySelector('button[aria-label*="Show" i]') ? safeClick(expSection.querySelector('button[aria-label*="Show" i]')) : null);
      // Prefer visible list items inside the experience section only
      const items = qsa('li', expSection).filter(li=>li.querySelector('div.display-flex'));
      items.forEach(li=>{
        const title = cleanText(normalizeText(getText(li.querySelector('span[aria-hidden="true"], .t-bold, .mr1.t-bold'))));
        const company = cleanText(normalizeText(getText(li.querySelector('span.t-14.t-normal, .pv-entity__secondary-title, .t-14.t-normal.t-black'))));
        const dates = cleanText(normalizeText(getText(li.querySelector('.t-14.t-normal.t-black--light, .pv-entity__date-range, .pvs-entity__caption-wrapper'))));
        const location = cleanText(normalizeText(getText(li.querySelector('.t-14.t-normal.t-black--light:nth-of-type(2), .pvs-entity__caption-wrapper span'))));
        const description = cleanText(normalizeText(getText(li.querySelector('.pv-entity__extra-details, .inline-show-more-text, .pvs-list__outer-container'))));
        if (title || company) experiences.push({ title, company, dates, location, description });
      });
      return experiences;
    }

    async function scrapeSkills(){
      const skills = [];
      const topSkills = [];
      const root = getRoot();
      for (let i=0;i<cfg.skillsMaxExpandClicks;i++){
        const showAll = qsa('button', root).find(b=>contains(b,'Show all skills')||contains(b,'Show all'));
        if (showAll){ safeClick(showAll); await sleep(400); } else break;
      }
      const section = findSectionByIdOrHeading(root,'skills','Skills');
      if (!section) return { skills, topSkills };
      await ensureInView(section);
      qsa('li', section).forEach(li=>{
        const sEl = li.querySelector('span[aria-hidden="true"], .pv-skill-category-entity__name-text, .mr1.t-bold');
        const name = cleanText(normalizeText(getText(sEl)));
        if (!name) return;
        // Filter labels or very long paragraphs
        const lower = name.toLowerCase();
        if (['top skills','about','highlights','activity'].some(k=>lower.includes(k))) return;
        if (name.length > 80) return; // avoid paragraph leaks
        if (!skills.includes(name)) skills.push(name);
        const countEl = li.querySelector('.t-12.t-normal.t-black--light, .pv-skill-category-entity__endorsement-count');
        const count = parseInt((getText(countEl).match(/\d+/)||[])[0]||'0',10);
        if (count>0) topSkills.push({ name, endorsements: count });
      });
      // Dedupe topSkills by name
      const seen = new Set();
      const dedupTop = [];
      for (const t of topSkills){ if (!seen.has(t.name)){ seen.add(t.name); dedupTop.push(t); } }
      return { skills, topSkills: dedupTop };
    }

    function scrapeLicenses(){
      const out = [];
      const root = getRoot();
      const section = findSectionByIdOrHeading(root,'licenses','Licenses');
      if (!section) return out;
      const seen = new Set();
      qsa('li', section).forEach(li=>{
        const name = cleanText(normalizeText(getText(li.querySelector('.t-bold, span[aria-hidden="true"], .mr1.t-bold'))));
        const issuer = cleanText(normalizeText(getText(li.querySelector('.t-14.t-normal, .pv-entity__secondary-title, .t-14.t-normal.t-black'))));
        const dates = cleanText(normalizeText(getText(li.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper'))));
        if (name) out.push({ name, issuer, dates });
      });
      // Dedupe exact duplicates
      return out.filter(l=>{ const key = `${l.name}|${l.issuer}|${l.dates}`; if (seen.has(key)) return false; seen.add(key); return true; });
    }

    function scrapeEducation(){
      const out = [];
      const root = getRoot();
      const section = findSectionByIdOrHeading(root,'education','Education');
      if (!section) return out;
      qsa('li', section).forEach(li=>{
        const college = cleanText(normalizeText(getText(li.querySelector('.t-bold, span[aria-hidden="true"], .mr1.t-bold'))));
        // Degree and field variation containers
        const degree = cleanText(normalizeText(getText(li.querySelector('.t-14.t-normal, .pv-entity__secondary-title, .t-14.t-normal.t-black, .t-14.t-normal.t-black--light'))));
        const dates = cleanText(normalizeText(getText(li.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper'))));
        if (college || degree || dates){ out.push({ college, degree, dates }); }
      });
      return out;
    }

    async function scrapeProfile(){
      const startedAt = Date.now();
      STATE.scraping = true;
      const restoreNav = blockNavigation();
      try {
        await expandSectionButtons();
        // Bring key sections into view pre-emptively
        const root = getRoot();
        await ensureInView(findSectionByIdOrHeading(root,'about','About'));
        await ensureInView(findSectionByIdOrHeading(root,'experience','Experience'));
        await ensureInView(findSectionByIdOrHeading(root,'skills','Skills'));
        await ensureInView(findSectionByIdOrHeading(root,'licenses','Licenses'));
        await ensureInView(findSectionByIdOrHeading(root,'education','Education'));
        const basic = scrapeBasic();
        const [contact, skills] = await Promise.all([
          withTimeout(scrapeContactInfo(), cfg.longTimeout, 'contact-info'),
          withTimeout(scrapeSkills(), cfg.longTimeout, 'skills')
        ]);
        const summary = scrapeSummary();
        const experience = scrapeExperience();
        const licenses = scrapeLicenses();
        const education = scrapeEducation();
        const data = { url: location.href, fetchedAt: new Date().toISOString(), basic, contact, summary, experience, education, skills: skills.skills, topSkills: skills.topSkills, licenses };
        // Provide a normalized mapping used by the popup/UI
        const normalized = {
          linkedinUrl: data.url,
          name: basic.name || '',
          title: basic.headline || '',
          contactInfo: contact || { emails: [], phones: [], websites: [], location: '' },
          topSkills: (skills.topSkills||[]).map(s=> typeof s === 'string' ? s : s?.name).filter(Boolean).slice(0,10),
          aboutSummary: summary || '',
          experience: (experience||[]).map(e=>({ company: e.company||'', designation: e.title||'', dates: e.dates||'' })),
          education: (education||[]).map(ed=>({ college: ed.college||'', degree: ed.degree||'', dates: ed.dates||'' })),
          certifications: (licenses||[]).map(l=>({ name: l.name||'', authority: l.issuer||'', date: l.dates||'' })),
        };
        STATE.cache[location.href] = data;
        chrome.runtime.sendMessage({ type: 'SCRAPE_RESULT', payload: { ...data, normalized } }, ()=>{});
        log('Scrape complete in', Date.now()-startedAt, 'ms');
        return data;
      } catch (e){
        log('Scrape error', e);
        chrome.runtime.sendMessage({ type: 'SCRAPE_ERROR', error: e?.message||String(e), url: location.href });
        // Return cached or minimal data to keep the pipeline flowing
        const fallback = STATE.cache[location.href] || { url: location.href, fetchedAt: new Date().toISOString(), basic: scrapeBasic() };
        return fallback;
      } finally {
        STATE.scraping = false;
        try { restoreNav && restoreNav(); } catch{}
      }
    }

    function onUrlChange(newUrl){
      if (newUrl === STATE.currentUrl) return;
      STATE.currentUrl = newUrl;
      log('URL changed:', newUrl);
      if (isLinkedInUrl(newUrl) && isProfileUrl(newUrl)){
        // Debounce slight delay to allow DOM to settle
        setTimeout(()=>{ scrapeProfile(); }, 800);
      }
    }

    function hookHistory(){
      const push = history.pushState;
      const replace = history.replaceState;
      history.pushState = function(){ push.apply(this, arguments); setTimeout(()=>onUrlChange(location.href), 0); };
      history.replaceState = function(){ replace.apply(this, arguments); setTimeout(()=>onUrlChange(location.href), 0); };
      window.addEventListener('popstate', ()=>onUrlChange(location.href));
    }

    function observeMain(){
      const obs = new MutationObserver(()=>{
        // On large DOM changes for profile pages, attempt to rescan lightweight
        if (isLinkedInUrl(location.href) && isProfileUrl(location.href) && !STATE.scraping){
          // quick update for name/headline changes when navigating sub-tabs
          const basic = scrapeBasic();
          if (basic.name){
            const cached = STATE.cache[location.href] || {};
            STATE.cache[location.href] = { ...cached, basic, url: location.href, fetchedAt: new Date().toISOString() };
          }
        }
      });
      obs.observe(getRoot() || document.documentElement, { childList: true, subtree: true });
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse)=>{
      if (msg === 'PING' || msg?.type === 'PING'){
        sendResponse({ ok: true, url: location.href, loaded: true });
        return true;
      }
      if (msg === 'TRIGGER_SCRAPE' || msg?.type === 'TRIGGER_SCRAPE'){
        if (!isLinkedInUrl(location.href) || !isProfileUrl(location.href)){
          sendResponse({ ok: false, error: 'Open a LinkedIn profile (URL like linkedin.com/in/...) and try again.' });
          return true;
        }
        (async ()=>{
          const data = await scrapeProfile();
          sendResponse({ ok: !!data, data });
        })();
        return true; // async
      }
      if (msg === 'CHECK_READY' || msg?.type === 'CHECK_READY'){
        sendResponse({ ok: true, flag: !!window.__RCRM_CONTENT__, url: location.href });
        return true;
      }
      if (msg?.type === 'GET_CACHE'){
        sendResponse({ ok: true, data: STATE.cache[location.href] || null });
        return true;
      }
    });

    // Init
    if (isLinkedInUrl(location.href)){
      hookHistory();
      observeMain();
      // Initial trigger if already on a profile
      if (isProfileUrl(location.href)){
        setTimeout(()=>scrapeProfile(), 1000);
      }
    } else {
      log('Non-LinkedIn page detected; idle');
    }

    log('Initialized');
    // Notify background that content is ready on this tab
    try { chrome.runtime.sendMessage({ type: 'INIT', url: location.href }); } catch {}
  })();
}
