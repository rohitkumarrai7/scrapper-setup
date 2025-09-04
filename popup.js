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

// Add a longer timeout for the scrape response and progress updates
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
  $('btnPdf').disabled = true;

  try {
    const resp = await sendMessageWithTimeout(
      { type: 'SCRAPE_PROFILE', options: getOptions() }
    );
    if (!resp || !resp.ok) {
      setStatus('Error: ' + (resp?.error || 'Scrape failed'));
      return;
    }
    lastData = resp.data;

    // Opportunistic light DOM fallback to enrich missing fields
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setStatus(lastData && lastData.complete ? 'Scrape complete. PDF ready.' : 'Scrape complete (partial).');
        $('btnPdf').disabled = lastData && lastData.complete ? false : true;
        return;
      }
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        // Proceed without lite data if content script did not respond in time
        setStatus(lastData && lastData.complete ? 'Scrape complete. PDF ready.' : 'Scrape complete (partial).');
        $('btnPdf').disabled = lastData && lastData.complete ? false : true;
      }, 15000);
      chrome.tabs.sendMessage(tab.id, { action: 'getProfileData' }, (lite) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (chrome.runtime.lastError) {
          // Content script may have been reloaded/navigated; ignore and proceed
          setStatus(lastData && lastData.complete ? 'Scrape complete. PDF ready.' : 'Scrape complete (partial).');
          $('btnPdf').disabled = lastData && lastData.complete ? false : true;
          return;
        }
        if (lite && lite.ok && lite.data) {
          if ((!lastData.about || !lastData.about.trim()) && lite.data.about) {
            lastData.about = lite.data.about;
          }
          const liteSkills = Array.isArray(lite.data.skills) ? lite.data.skills.filter(Boolean) : [];
          const haveTop = Array.isArray(lastData.topSkills) && lastData.topSkills.length;
          if (!haveTop && liteSkills.length) {
            lastData.topSkills = Array.from(new Set(liteSkills)).slice(0, 10);
          }
        }
        setStatus(lastData && lastData.complete ? 'Scrape complete. PDF ready.' : 'Scrape complete (partial).');
        $('btnPdf').disabled = lastData && lastData.complete ? false : true;
      });
    });
  } catch (e) {
    setStatus('Error: ' + e.message);
  } finally {
    $('btnScrape').disabled = false;
  }
});

$('btnPdf').addEventListener('click', async () => {
  if (!lastData) {
    setStatus('No data yet. Please scrape first.');
    return;
  }
  setStatus('Generating PDF…');
  try {
    await generateProfilePDF(lastData); // Defined in pdfGenerator.js
    setStatus('PDF downloaded.');
  } catch (e) {
    setStatus('PDF error: ' + e.message);
  }
});

$('btnViewLast').addEventListener('click', () => {
  setStatus('Loading last data…', true);
  chrome.runtime.sendMessage({ type: 'GET_LAST_DATA' }, (resp) => {
    if (resp && resp.ok && resp.data) {
      lastData = resp.data;
      $('btnPdf').disabled = lastData && lastData.complete ? false : true;
      setStatus('Loaded last data from storage.');
    } else {
      setStatus('No saved data found.', true);
    }
  });
});

$('btnOptions').addEventListener('click', () => {
  setStatus('No extra options yet. Use checkboxes above.', true);
});
