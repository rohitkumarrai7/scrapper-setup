let lastData = null;
const $ = (id) => document.getElementById(id);

const setStatus = (msg, muted = false) => {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (muted ? ' muted' : '');
};

function getOptions() {
  return {
    includeComments: $('optComments') ? $('optComments').checked : false,
    includeSkills: $('optSkills') ? $('optSkills').checked : false,
    includeContact: $('optContact') ? $('optContact').checked : false,
  };
}

// Longer timeout window for end-to-end scrape
const TIMEOUT_MS = 90000;

function sendMessageWithTimeout(msg) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Timed out waiting for scrape to finish'));
    }, TIMEOUT_MS);

    chrome.runtime.sendMessage(msg, (resp) => {
      if (settled) return;
      clearTimeout(t);
      if (chrome.runtime.lastError) {
        settled = true;
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        settled = true;
        resolve(resp);
      }
    });
  });
}

// Listen for progress pings from content.js
chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === 'SCRAPE_PROGRESS') {
    const step = m.step || 'progress';
    const detail = m.detail ? ` - ${m.detail}` : '';
    setStatus(`[${step}]${detail}`, true);
  }
});

$('btnScrape').addEventListener('click', async () => {
  setStatus('Scraping profile…');
  $('btnScrape').disabled = true;
  $('btnSaveCache').disabled = true;
  $('btnPushATS') && ($('btnPushATS').disabled = true);

  try {
    const resp = await sendMessageWithTimeout(
      { type: 'SCRAPE_PROFILE', options: getOptions() }
    );
    if (!resp || !resp.ok) {
      setStatus('Error: ' + (resp?.error || 'Scrape failed'));
      return;
    }
    lastData = resp.data;

    // Auto-save to cache
    try {
      await sendMessageWithTimeout({ type: 'SAVE_LAST_SCRAPE', data: lastData });
    } catch {}

    // Light DOM fallback enrichment (optional)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setStatus('Scrape complete. Cached.');
        $('btnSaveCache').disabled = !lastData;
        $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
        return;
      }
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        setStatus('Scrape complete. Cached.');
        $('btnSaveCache').disabled = !lastData;
        $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
      }, 15000);
      chrome.tabs.sendMessage(tab.id, { action: 'getProfileData' }, (lite) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (!chrome.runtime.lastError && lite && lite.ok && lite.data) {
          if ((!lastData.about || !lastData.about.trim()) && lite.data.about) {
            lastData.about = lite.data.about;
          }
          const liteSkills = Array.isArray(lite.data.skills) ? lite.data.skills.filter(Boolean) : [];
          const haveTop = Array.isArray(lastData.topSkills) && lastData.topSkills.length;
          if (!haveTop && liteSkills.length) {
            lastData.topSkills = Array.from(new Set(liteSkills)).slice(0, 10);
          }
        }
        setStatus('Scrape complete. Cached.');
        $('btnSaveCache').disabled = !lastData;
        $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
      });
    });
  } catch (e) {
    setStatus('Error: ' + e.message);
  } finally {
    $('btnScrape').disabled = false;
  }
});

$('btnSaveCache').addEventListener('click', async () => {
  if (!lastData) {
    setStatus('No data yet. Please scrape first.');
    return;
  }
  try {
    const resp = await sendMessageWithTimeout({ type: 'SAVE_LAST_SCRAPE', data: lastData });
    if (resp && resp.ok) setStatus('Saved to cache.');
    else setStatus('Failed to save cache.', true);
  } catch (e) {
    setStatus('Failed to save cache: ' + e.message, true);
  }
});

$('btnViewLast').addEventListener('click', async () => {
  setStatus('Loading last cached…', true);
  try {
    const resp = await sendMessageWithTimeout({ type: 'GET_LAST_SCRAPE' });
    if (resp && resp.ok && resp.data) {
      lastData = resp.data;
      $('btnSaveCache').disabled = !lastData;
      $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
      setStatus('Loaded from cache. Check console for details.');
      try { console.log('Last cached profile:', lastData); } catch {}
    } else {
      setStatus('No cached data found.', true);
    }
  } catch (e) {
    setStatus('Error: ' + e.message, true);
  }
});

$('btnPushATS') && $('btnPushATS').addEventListener('click', async () => {
  if (!lastData) { setStatus('Nothing to push. Scrape or load cache first.', true); return; }
  setStatus('Preparing push…', true);
  // TODO: integrate with OptyMatch ATS API
  try {
    const resp = await sendMessageWithTimeout({ type: 'PUSH_TO_ATS', data: lastData });
    if (resp && resp.ok) setStatus('Pushed to ATS.');
    else setStatus('ATS push not implemented yet.', true);
  } catch {
    setStatus('ATS push not implemented yet.', true);
  }
});

// DevTools helper for quick validation before UI arrives
window.getLastScrape = async function () {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_LAST_SCRAPE' }, (resp) => {
      try { if (resp && resp.ok) console.log('Last cached profile:', resp.data); } catch {}
      resolve(resp && resp.ok ? resp.data : null);
    });
  });
};
