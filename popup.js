let lastData = null;
const $ = (id) => document.getElementById(id);

const setStatus = (msg, muted = false) => {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (muted ? ' muted' : '');
};

function getOptions() {
  return {
    includeSkills: $('optSkills') ? $('optSkills').checked : false,
    includeContact: $('optContact') ? $('optContact').checked : false,
  };
}

// Longer timeout window for end-to-end scrape (big profiles may need more time)
const TIMEOUT_MS = 180000;

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
  // Headline removed per client request
  const hl = null;
  const url = $('candidateUrl');
  const ci = $('contactInfo');
  const sm = $('summary');
  const sk = $('skills');
  // Top Skills removed per client request
  const tsk = null;
  const ex = $('experience');
  const ed = $('education');
  const lc = $('certifications');

  if (pic) pic.src = data.profilePic || '';
  if (nm) nm.textContent = data.name || '';
  // headline suppressed
  // if (hl) hl.textContent = data.headline || '';
  if (url) {
    url.textContent = '';
    url.onclick = null;
  }

  // Contact Info: show ONLY Emails and LinkedIn URL
  if (ci) {
    const emails = Array.isArray(data?.contactInfo?.emails) ? data.contactInfo.emails.filter(Boolean) : [];
    const rows = [];
    if (data.profileUrl) rows.push(`<div>• LinkedIn: <a href="${data.profileUrl}" target="_blank" rel="noopener noreferrer">${data.profileUrl}</a></div>`);
    if (emails.length) rows.push(`<div>• Email: ${emails.join(', ')}</div>`);
    ci.innerHTML = rows.join('');
    if (!emails.length && !data.profileUrl) ci.textContent = '';
  }

  // Summary: About only (no headline fallback here)
  if (sm) sm.textContent = (data.about && data.about.trim()) ? data.about : '';

  // Sanitize helpers for labels
  const collapseDupSegments = (s) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const mid = Math.floor(s.length / 2);
    if (s.length % 2 === 0 && s.slice(0, mid) === s.slice(mid)) return s.slice(0, mid).trim();
    const seps = [' · ', ' | ', ' – ', ' - '];
    for (const sep of seps) {
      if (s.includes(sep)) {
        const parts = s.split(sep).map(p => p.trim()).filter(Boolean);
        const out = [];
        for (const p of parts) if (out[out.length - 1] !== p) out.push(p);
        return out.join(sep);
      }
    }
    return s;
  };
  const cleanSkillLabel = (s) => {
    let x = (s || '').replace(/\s+/g, ' ').trim();
    if (!x) return '';
    // remove concatenated duplicates like "User JourneysUser Journeys"
    x = x.replace(/^(.+?)\1$/i, '$1').trim();
    // remove endorsement counters
    x = x.replace(/\b\d+\s*endorsements?\b/ig, '').trim();
    // remove institutions/courses/noise
    const bad = /(university|college|institute|school|academy|xlri|baddi|executive\s+program|program\b|course\b|certificat(e|ion)|diploma|bachelor|master|mba|b\.\s*tech|m\.\s*tech|budha|solan|campus|degree)/i;
    if (bad.test(x)) return '';
    return x;
  };

  // Top Skills removed
  // All Skills (excluding Top Skills to avoid duplication)
  if (sk) {
    const allSkills = Array.isArray(data.skills) ? data.skills.map(cleanSkillLabel).filter(Boolean) : [];
    // Cap to 5 skills max per client
    const shown = allSkills.slice(0, 5);
    sk.innerHTML = shown.map(s => `<span class="chip">${s}</span>`).join(' ');
    if (!shown.length) sk.textContent = '';
  }

  if (ex) {
    const arr = Array.isArray(data.experience) ? data.experience : [];
    ex.innerHTML = arr.map(exp => {
      const comp = collapseDupSegments(exp.company || '');
      const title = collapseDupSegments(exp.title || '');
      const dr = collapseDupSegments(exp.dateRange || '');
      return [
        comp ? `<strong>Company:</strong> ${comp}` : '',
        title ? `<strong>Designation:</strong> ${title}` : '',
        dr ? `<strong>Dates:</strong> ${dr}` : ''
      ].filter(Boolean).join(' · ');
    }).join('<br/>');
    if (!arr.length) ex.textContent = '';
  }

  if (ed) {
    const arr = Array.isArray(data.education) ? data.education : [];
    ed.innerHTML = arr.map(edc => {
      const school = collapseDupSegments(edc.school || '');
      const degree = collapseDupSegments(edc.degree || '');
      const dr = collapseDupSegments(edc.dateRange || '');
      return [
        school ? `<strong>College:</strong> ${school}` : '',
        degree ? `<strong>Degree:</strong> ${degree}` : '',
        dr ? `<strong>Dates:</strong> ${dr}` : ''
      ].filter(Boolean).join(' · ');
    }).join('<br/>');
    if (!arr.length) ed.textContent = '';
  }

  if (lc) {
    const arr = Array.isArray(data.licenses) ? data.licenses : [];
    lc.innerHTML = arr.map(cert => {
      const name = collapseDupSegments(cert.name || '');
      const issuer = collapseDupSegments(cert.issuer || '');
      const dt = collapseDupSegments(cert.date || '');
      return [
        name ? `<strong>Certification:</strong> ${name}` : '',
        issuer ? `<strong>Issuer:</strong> ${issuer}` : '',
        dt ? `<strong>Date:</strong> ${dt}` : ''
      ].filter(Boolean).join(' · ');
    }).join('<br/>');
    if (!arr.length) lc.textContent = '';
  }
}

// -------- Resume Uploader (Drag & Drop + File Input) --------
let resumeUpload = null; // { name, size, type, base64 }

function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function showFileMeta() {
  const fm = $('fileMeta');
  if (!fm) return;
  if (!resumeUpload) { fm.textContent = ''; return; }
  const { name, size, type } = resumeUpload;
  fm.textContent = `${name} • ${humanSize(size)} • ${type}`;
}

function validateFile(file) {
  if (!file) return 'No file selected';
  const okExt = /(\.pdf|\.docx)$/i.test(file.name);
  const okMime = (
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    (!file.type && okExt) // Chrome sometimes leaves .docx mime empty
  );
  if (!okExt || !okMime) return 'Only PDF or DOCX files are allowed.';
  const maxBytes = 10 * 1024 * 1024; // 10 MB safety
  if (file.size > maxBytes) return 'File is too large (max 10 MB).';
  return '';
}

function readFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Failed to read file'));
    fr.onload = () => {
      try {
        const dataUrl = String(fr.result || '');
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
        resolve(base64);
      } catch (e) { reject(e); }
    };
    fr.readAsDataURL(file);
  });
}

async function handleFiles(files) {
  const file = files && files[0];
  const err = validateFile(file);
  if (err) { setStatus(err, true); return; }
  setStatus('Reading file…', true);
  try {
    const base64 = await readFileToBase64(file);
    resumeUpload = { name: file.name, size: file.size, type: file.type || (/.docx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'), base64 };
    showFileMeta();
    setStatus('Resume attached (in memory).', true);
    try { chrome.storage.session.set({ resumeUpload }); } catch {}
  } catch (e) {
    setStatus('Failed to read file.', true);
  }
}

function setupUploader() {
  const dz = $('dropzone');
  const fi = $('fileInput');
  if (!dz || !fi) return;

  // Restore from session (in-memory between popup openings this session)
  try {
    chrome.storage.session.get('resumeUpload', (res) => {
      if (res && res.resumeUpload && res.resumeUpload.base64) {
        resumeUpload = res.resumeUpload;
        showFileMeta();
      }
    });
  } catch {}

  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', (e) => {
    const files = e.target && e.target.files ? e.target.files : null;
    if (files && files.length) handleFiles(files);
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('hover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('hover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('hover');
    const files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
    if (files && files.length) handleFiles(files);
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
    let data = resp && resp.ok ? resp.data : null;
    if (!data) {
      // Fallback: read directly from session, then local
      data = await new Promise((resolve) => {
        try {
          chrome.storage.session.get('lastScrape', (res) => {
            if (chrome.runtime.lastError) {
              chrome.storage.local.get('lastScrape', (res2) => resolve(res2 && res2.lastScrape ? res2.lastScrape : null));
            } else if (res && res.lastScrape) {
              resolve(res.lastScrape);
            } else {
              chrome.storage.local.get('lastScrape', (res2) => resolve(res2 && res2.lastScrape ? res2.lastScrape : null));
            }
          });
        } catch (e) {
          chrome.storage.local.get('lastScrape', (res2) => resolve(res2 && res2.lastScrape ? res2.lastScrape : null));
        }
      });
    }
    if (data) {
      lastData = data;
      $('btnSaveCache').disabled = !lastData;
      $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
      setStatus('Loaded from cache.');
      try { console.log('Last cached profile (fallback-aware):', lastData); } catch {}
      renderProfile(lastData);
    } else {
      setStatus('No cached data found.', true);
    }
  } catch (e) {
    // Fallback path if messaging failed entirely
    try {
      const data = await new Promise((resolve) => {
        chrome.storage.session.get('lastScrape', (res) => {
          if (chrome.runtime.lastError) {
            chrome.storage.local.get('lastScrape', (res2) => resolve(res2 && res2.lastScrape ? res2.lastScrape : null));
          } else if (res && res.lastScrape) {
            resolve(res.lastScrape);
          } else {
            chrome.storage.local.get('lastScrape', (res2) => resolve(res2 && res2.lastScrape ? res2.lastScrape : null));
          }
        });
      });
      if (data) {
        lastData = data;
        $('btnSaveCache').disabled = !lastData;
        $('btnPushATS') && ($('btnPushATS').disabled = !lastData);
        setStatus('Loaded from cache.');
        renderProfile(lastData);
        return;
      }
      setStatus('No cached data found.', true);
    } catch (e2) {
      setStatus('Error: ' + e.message, true);
    }
  }
});

$('btnPushATS') && $('btnPushATS').addEventListener('click', async () => {
  if (!lastData) { setStatus('Nothing to push. Scrape or load cache first.', true); return; }
  setStatus('Preparing push…', true);
  // TODO: integrate with OptyMatch ATS API
  try {
    // Attach resume (kept only in session memory) to the outgoing data
    const payload = Object.assign({}, lastData);
    if (resumeUpload && resumeUpload.base64) {
      payload.resume = {
        name: resumeUpload.name,
        size: resumeUpload.size,
        type: resumeUpload.type,
        base64: resumeUpload.base64,
      };
    }
    const resp = await sendMessageWithTimeout({ type: 'PUSH_TO_ATS', data: payload });
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

// Resume uploader disabled per client request
// try { setupUploader(); } catch {}
