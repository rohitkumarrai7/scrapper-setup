//Sets of available environment
const ENV_URLS = {
  ENV: 'prod',
}

var BASE_BG_APP_URL, DEBUG_MODE;

switch (ENV_URLS.ENV) {
  case 'mark':
    BASE_BG_APP_URL = "https://mark.recruitcrm.io/";
    DEBUG_MODE = true;
    break
  case 'test':
    BASE_BG_APP_URL = "https://test.recruitcrm.io/";
    DEBUG_MODE = true;
    break
  case 'test2':
    BASE_BG_APP_URL = "https://test2.recruitcrm.io/";
    DEBUG_MODE = true;
    break
  case 'test3':
    BASE_BG_APP_URL = "https://test3.recruitcrm.io/";
    DEBUG_MODE = true;
    break
  case 'dev':
    BASE_BG_APP_URL = "https://dev.recruitcrm.io/";
    DEBUG_MODE = true;
    break;
  case 'prod':
    BASE_BG_APP_URL = "https://app.recruitcrm.io/"
    DEBUG_MODE = false;
    break;
  case 'canada':
    BASE_BG_APP_URL = "https://canada.recruitcrm.io/"
    DEBUG_MODE = false;
    break;
  case 'local':
    BASE_BG_APP_URL = "http://localhost/";
    BASE_BG_APP_URL = "https://staging.recruitcrm.io/"
    DEBUG_MODE = true;
    break;
  default:
    BASE_BG_APP_URL = "https://app.recruitcrm.io/";
    DEBUG_MODE = true;
    break
}

const do_log = (...args) => { if (DEBUG_MODE) console.log('[RCRM-BG]', ...args); };

// Utility
function isLinkedIn(url){ return /^https:\/\/.*linkedin\.com\//.test(url||''); }

async function ensureContent(tabId){
  const alive = await pingContent(tabId);
  if (!alive){
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); do_log('Injected content.js into', tabId); } catch(e){ do_log('ensureContent inject error', e?.message); }
  }
}

async function tryAutoTrigger(tab){
  if (!tab?.id) return;
  try{
    await ensureContent(tab.id);
    // attempt a quick cache read first
    try { await chrome.tabs.sendMessage(tab.id, { type: 'GET_CACHE' }); } catch {}
    const data = await triggerScrape(tab.id, { retries: 2, timeoutMs: 20000 });
    do_log('Auto-trigger success', { id: tab.id, url: data?.url, name: data?.basic?.name });
  }catch(e){ do_log('Auto-trigger skipped/failure', e?.message); }
}

// Inject into all existing LinkedIn tabs on install/start
chrome.runtime.onInstalled.addListener(async ()=>{
  try{
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    for (const t of tabs){ await ensureContent(t.id); }
    do_log('onInstalled: ensured content on', tabs.length, 'LinkedIn tabs');
  }catch(e){ do_log('onInstalled error', e?.message); }
});

chrome.runtime.onStartup.addListener(async ()=>{
  try{
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    for (const t of tabs){ await ensureContent(t.id); }
    do_log('onStartup: ensured content on', tabs.length, 'LinkedIn tabs');
  }catch(e){ do_log('onStartup error', e?.message); }
});

// Heal on navigation and optionally auto-trigger
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab)=>{
  if (!isLinkedIn(tab?.url)) return;
  // When the page completes or URL changes (SPA can fire updates), ensure content is present
  if (changeInfo.status === 'complete' || changeInfo.url){
    await ensureContent(tabId);
    // Optional: if on a profile URL, auto-trigger scrape without user click
    try { await chrome.tabs.sendMessage(tabId, { type: 'PING' }); } catch {}
    // Heuristic: only auto-trigger on /in/ paths to avoid noise on feeds
    if (/\/in\//.test(tab.url||'')){
      tryAutoTrigger(tab);
    }
  }
});

// Ensure third-party cookies allowed (required for embedded app usage)
let errorRunExtension = false;
let errorMessage = "message";
chrome.privacy.websites.thirdPartyCookiesAllowed.get({}, function (setting) {
  if (!setting.value) {
    if (setting.levelOfControl == 'controllable_by_this_extension' || setting.levelOfControl == 'controlled_by_this_extension') {
      chrome.privacy.websites.thirdPartyCookiesAllowed.set({ 'value': true });
    } else {
      errorRunExtension = true;
      errorMessage = "The extension cannot work right now because third-party cookies are blocked by other software. Please contact us for more details.";
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message == "init?") {
    sendResponse({ errorRunExtension, errorMessage });
    return true;
  }
  if (request.type === 'SCRAPE_RESULT'){
    do_log('Received SCRAPE_RESULT', { url: request.payload?.url, basic: request.payload?.basic });
    // Optionally, we can cache per tab if needed
    return true;
  }
  if (request.type === 'SCRAPE_ERROR'){
    do_log('Received SCRAPE_ERROR', request);
    return true;
  }
});

async function pingContent(tabId){
  try{
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return resp?.ok === true;
  }catch(e){ return false; }
}

async function triggerScrape(tabId, { retries = 2, timeoutMs = 10000 } = {}){
  for (let attempt=0; attempt<=retries; attempt++){
    try{
      const res = await new Promise((resolve, reject)=>{
        let done = false;
        const to = setTimeout(()=>{ if(!done){ done=true; reject(new Error('Timed out waiting for scrape to finish')); } }, timeoutMs);
        chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_SCRAPE' }, (resp)=>{
          if (chrome.runtime.lastError){
            clearTimeout(to); if(!done){ done=true; reject(new Error(chrome.runtime.lastError.message)); }
            return;
          }
          clearTimeout(to); if(!done){ done=true; resolve(resp); }
        });
      });
      if (res?.ok){ return res.data; }
      // Fallback: try return cached data if available
      do_log('Scrape response not ok; attempting cache fallback');
      const cache = await chrome.tabs.sendMessage(tabId, { type: 'GET_CACHE' }).catch(()=>null);
      if (cache?.ok && cache?.data){
        do_log('Using cache fallback');
        return cache.data;
      }
      throw new Error(res?.error || 'Scrape failed');
    }catch(err){
      do_log('triggerScrape error', err?.message);
      if (attempt < retries){
        // Try reinjecting the content script defensively, then retry
        try{
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          do_log('content.js reinjected');
        }catch(e){ do_log('reinjection failed or not needed', e?.message); }
        await new Promise(r=>setTimeout(r, 500 + attempt*300));
        continue;
      } else {
        throw err;
      }
    }
  }
}

chrome.action.onClicked.addListener(async function (tab) {
  if (!tab?.id) return;
  try{
    // Only proceed on LinkedIn
    if (!isLinkedIn(tab?.url)) return;
    // Ping content
    const alive = await pingContent(tab.id);
    if (!alive){
      do_log('Content not alive, attempting reinjection');
      try{ await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); }catch(e){ do_log('reinjection error', e?.message); }
    }
    const data = await triggerScrape(tab.id, { retries: 3, timeoutMs: 30000 });
    do_log('Scrape success', { url: data?.url, name: data?.basic?.name });
  }catch(e){
    console.error('Error:', e.message);
  }
});