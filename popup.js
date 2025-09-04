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

// Render the profile data into the popup UI
function renderProfile(data) {
  if (!data) return;
  const pv = $('profileView');
  if (!pv) return;
  pv.style.display = 'block';

  const pic = $('profilePic');
  const nm = $('candidateName');
  const hl = $('candidateHeadline');
  const url = $('candidateUrl');
  const ci = $('contactInfo');
  const sm = $('summary');
  const sk = $('skills');
  const ex = $('experience');
  const ed = $('education');
  const lc = $('certifications');

  if (pic) pic.src = data.profilePic || '';
  if (nm) nm.textContent = data.name || '—';
  if (hl) hl.textContent = data.headline || '—';
  if (url) {
    url.textContent = data.profileUrl || '';
    url.onclick = () => { if (data.profileUrl) chrome.tabs.create({ url: data.profileUrl }); };
  }

  if (ci) {
    ci.innerHTML = '';
    const c = data.contactInfo || {};
    const emails = Array.isArray(c.emails) ? c.emails : [];
    const phones = Array.isArray(c.phones) ? c.phones : [];
    const websites = Array.isArray(c.websites) ? c.websites : [];
    emails.forEach(e => ci.innerHTML += `• Email: ${e}<br/>`);
    phones.forEach(p => ci.innerHTML += `• Phone: ${p}<br/>`);
    websites.forEach(w => ci.innerHTML += `• Website: ${w}<br/>`);
    if (!emails.length && !phones.length && !websites.length) ci.textContent = '—';
  }

  if (sm) sm.textContent = data.about || '—';

  if (sk) {
    const arr = Array.isArray(data.skills) ? data.skills : [];
    sk.innerHTML = arr.map(s => `<span class="chip">${s}</span>`).join(' ');
    if (!arr.length) sk.textContent = '—';
  }

  if (ex) {
    const arr = Array.isArray(data.experience) ? data.experience : [];
    ex.innerHTML = arr.map(exp => {
      const comp = exp.company || '';
      const title = exp.title || '';
      const dr = exp.dateRange || '';
      return `${comp}${comp && title ? ' — ' : ''}${title}${dr ? ` (${dr})` : ''}`;
    }).join('<br/>');
    if (!arr.length) ex.textContent = '—';
  }

  if (ed) {
    const arr = Array.isArray(data.education) ? data.education : [];
    ed.innerHTML = arr.map(edc => {
      const school = edc.school || '';
      const degree = edc.degree || '';
      const dr = edc.dateRange || '';
      return `${school}${school && degree ? ' — ' : ''}${degree}${dr ? ` (${dr})` : ''}`;
    }).join('<br/>');
    if (!arr.length) ed.textContent = '—';
  }

  if (lc) {
    const arr = Array.isArray(data.licenses) ? data.licenses : [];
    lc.innerHTML = arr.map(cert => {
      const name = cert.name || '';
      const issuer = cert.issuer || '';
      const dt = cert.date || '';
      return `${name}${issuer ? ' — ' + issuer : ''}${dt ? ' — ' + dt : ''}`;
    }).join('<br/>');
    if (!arr.length) lc.textContent = '—';
  }
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
        renderProfile(lastData);
        return;
      }
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        setStatus('Scrape complete. Cached.');
        $('btnSaveCache').disabled = !lastData;
        $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
        renderProfile(lastData);
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
        renderProfile(lastData);
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
      setStatus('Loaded from cache.');
      try { console.log('Last cached profile:', lastData); } catch {}
      renderProfile(lastData);
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
