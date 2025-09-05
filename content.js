// content.js
// MV3 content script for LinkedIn profile scraping

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const text = (el) => (el ? el.textContent.trim() : '');

  // ---- withOverallTimeout helper (robust overall timeout wrapper) ----
  function withOverallTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(`Scrape operation timed out after ${Math.round(timeoutMs/1000)}s`));
      }, timeoutMs);

      Promise.resolve(promise).then((res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      }).catch((err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // Progress ping to popup
  function progress(step, detail) {
    try { chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', step, detail }); } catch {}
  }

  // Send partial data to background so popup can retrieve last known good data
  function sendPartial(section, data) {
    try { chrome.runtime.sendMessage({ type: 'PARTIAL_DATA', section, data }); } catch (e) { /* ignore */ }
  }

  // Run a specific step with its own timeout so one slow step doesn't kill the whole scrape
  async function runWithStepTimeout(stepName, fn, ms = 8000, fallbackValue = null) {
    progress(stepName + ':start');
    try {
      const res = await Promise.race([
        Promise.resolve().then(() => fn()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('step-timeout:' + stepName)), ms))
      ]);
      progress(stepName + ':done', 'ok');
      return res;
    } catch (err) {
      console.warn(`Step "${stepName}" failed:`, err && err.message ? err.message : err);
      progress(stepName + ':failed', err && err.message ? err.message : String(err));
      return fallbackValue;
    }
  }

  // Fetch with timeout to prevent hanging requests
  async function fetchWithTimeout(url, opts = {}) {
    const { timeout = 12000, ...rest } = opts || {};
    let t;
    const guard = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('fetch-timeout: ' + url)), timeout); });
    try {
      const res = await Promise.race([fetch(url, rest), guard]);
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async function waitForSelector(sel, timeout = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const el = q(sel);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  async function waitForText(sel, timeout = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const el = q(sel);
      const t = text(el);
      if (el && t) return t;
      await sleep(150);
    }
    return '';
  }

  async function autoScroll(maxSteps = 6) {
    let last = 0;
    for (let i = 0; i < maxSteps; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(150);
      const cur = document.body.scrollHeight;
      if (cur === last) break;
      last = cur;
    }
    window.scrollTo(0, 0);
    await sleep(120);
  }

  async function expandWithin(root) {
    if (!root) return;
    // Only click true buttons to avoid any navigation
    const buttons = qa('button, [role="button"]:not(a)', root);
    for (const b of buttons) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (/(see more|show more)/.test(t)) {
        try { b.click(); await sleep(200); } catch (e) { console.warn('expandWithin click failed', e); }
      }
    }
  }

  function withinDays(date, days) {
    if (!date) return false;
    const now = new Date();
    const diff = (now - date) / (1000 * 60 * 60 * 24);
    return diff <= days;
  }

  function parseRelativeTime(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    const now = new Date();
    // Support words like "minutes", "hours", "days", "weeks", and abbreviations
    let m = s.match(/(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)/);
    if (m) {
      const val = parseInt(m[1], 10);
      const unit = m[2];
      let mult = 0;
      if (/^s(ec(ond)?s?)?$/i.test(unit)) mult = 1000;
      else if (/^m(in(ute)?s?)?$/i.test(unit)) mult = 60000;
      else if (/^h(r|our)s?$/i.test(unit)) mult = 3600000;
      else if (/^d(ay)?s?$/i.test(unit)) mult = 86400000;
      else if (/^w(eek)?s?$/i.test(unit)) mult = 604800000;
      const d = new Date(now);
      d.setTime(now.getTime() - val * mult);
      return d;
    }
    // Abbrev: like 2mo, 3y (treat > weeks as out of range)
    m = s.match(/(\d+)\s*(mo|month|months|y|yr|year|years)/);
    if (m) {
      // older than a week, skip by returning old date
      const val = parseInt(m[1], 10);
      const d = new Date(now);
      d.setTime(now.getTime() - (val * 30) * 86400000);
      return d;
    }
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) return new Date(parsed);
    return null;
  }

  async function clickIfExists(button) {
    if (!button) return false;
    (button instanceof HTMLElement) && button.click();
    await sleep(400);
    return true;
  }

  function getProfileUrl() {
    try {
      const u = new URL(location.href);
      const m = u.pathname.match(/\/in\/([^/]+)\/?/);
      if (m) return `https://www.linkedin.com/in/${m[1]}/`;
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return location.href;
    }
  }

  function metaFallbackNameHeadline() {
    let name = '';
    let headline = '';
    try {
      const ogTitle = q('meta[property="og:title"]')?.getAttribute('content') || '';
      if (ogTitle) {
        // Often like "Name | LinkedIn"
        name = ogTitle.split('|')[0].trim();
      }
      const ld = q('script[type="application/ld+json"]');
      if (ld) {
        try {
          const data = JSON.parse(ld.textContent || '{}');
          if (data && typeof data === 'object') {
            if (!name && data.name) name = data.name;
            // headline intentionally ignored
          }
        } catch {}
      }
    } catch {}
    return { name, headline };
  }

  function norm(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function splitSkillsInline(textContent) {
    const raw = (textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw) return [];
    return raw
      .split(/\s*[•|·,;\/]+\s*/)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s || s.length < 2) return false;
        if (/^\+\d+\s*skills$/i.test(s)) return false;
        // drop mostly numeric tokens
        const digits = (s.match(/\d/g) || []).length;
        const letters = (s.match(/[A-Za-z]/g) || []).length;
        if (!letters || digits > letters) return false;
        return true;
      });
  }

  function scrapeListSectionByHeading(headingRegex) {
    const items = [];
    try {
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (h2 && headingRegex.test(h2.textContent)) {
          const cards = qa('li, .pvs-list__paged-list-item, .artdeco-list__item', sec);
          for (const card of cards) {
            const title = norm(text(q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', card)));
            const subtitle = norm(text(q('.t-14.t-normal, .t-14.t-normal.t-black, .t-black--light, .display-flex span[aria-hidden="true"]', card)));
            const dates = norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time', card)));
            const description = norm(text(q('.pv-entity__extra-details, .pvs-list__outer-container p, .inline-show-more-text', card)));
            // Drop entries that look like bare filenames (e.g., image attachments like whatever.png)
            const looksLikeFile = (s) => /\.[a-z]{3,4}$/i.test(((s || '').split(/[\s\u00A0]+/).pop() || ''));
            if (looksLikeFile(title) || looksLikeFile(subtitle) || looksLikeFile(description)) continue;
            if (title || subtitle || dates || description) {
              items.push({ title, subtitle, dates, description });
            }
          }
          break;
        }
      }
    } catch (e) {
      console.warn('Section scrape failed:', headingRegex, e);
    }
    // Deduplicate by stable key
    const seen = new Set();
    const unique = [];
    for (const it of items) {
      const key = [it.title, it.subtitle, it.dates, it.description].join('||');
      if (key && !seen.has(key)) { seen.add(key); unique.push(it); }
    }
    return unique;
  }

  // Dedicated parsers for required fields
  function getExperience() {
    progress('experience', 'collect');
    const out = [];
    try {
      // Look for the Experience section by heading text
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (!h2 || !/experience/i.test(h2.textContent || '')) continue;
        const items = qa('li, .pvs-list__paged-list-item, .artdeco-list__item', sec);
        for (const li of items) {
          let company = norm(text(q('.t-14.t-normal.t-black, .pv-entity__secondary-title, .align-self-center span.t-14.t-normal', li)));
          let title = norm(text(q('.mr1.t-bold span[aria-hidden="true"], .t-bold span[aria-hidden="true"], span[aria-hidden="true"], .mr1.t-bold', li)));
          let dateRange = norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time', li)));

          // Clean noise: drop skill aggregates and obvious non-job snippets
          const noisy = /\b\+\d+\s*skills\b/i.test(title) || /\b\+\d+\s*skills\b/i.test(company) || /\bskills\b/i.test(company);
          if (noisy) { company = ''; title = ''; }
          company = cleanEntityField(company);
          title = cleanEntityField(title);
          // Require a valid date to prevent people/skills bleeding into Experience
          if (!dateRange || !/(\d{4}|present)/i.test(dateRange)) { continue; }
          // Skip if what we captured is actually a generic skill label
          if (GENERIC_SKILL_RE.test(company) || GENERIC_SKILL_RE.test(title)) continue;
          if (company && title && company.toLowerCase() === title.toLowerCase() && !ORG_HINT_RE.test(company)) continue;
          if (!(ORG_HINT_RE.test(company) || ORG_HINT_RE.test(title))) {
            const len = (company + ' ' + title).trim().length;
            if (len < 8) continue;
          }

          if (!(company || title || dateRange)) continue;
          company = collapseDupSegments(company);
          title = collapseDupSegments(title);
          dateRange = collapseDupSegments(dateRange);
          out.push({ company, title, dateRange });
        }
        break;
      }
    } catch (e) { console.warn('Experience parse failed', e); }
    return out;
  }

  // Deep fallback: fetch Experience details page
  async function scrapeExperienceDeep(profileUrl) {
    // Disabled deep experience fetch for speed
    try {
      const base = (profileUrl || '').replace(/\/recent-activity.*$/, '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
      const rootUrl = base ? base[0] : '';
      const url = rootUrl ? rootUrl + 'details/experience/' : '';
      const items = [];
      if (!url) return items;
      try {
        const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 15000 });
        if (res.ok) {
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const root = doc.querySelector('main') || doc;
          const cards = root.querySelectorAll('li, .pvs-list__paged-list-item, .artdeco-list__item');
          // disabled parsing
          cards.forEach((card) => {
            const titleRaw = (card.querySelector('span[aria-hidden="true"], .mr1.t-bold span, .t-bold') || {}).textContent || '';
            const companyRaw = (card.querySelector('.t-14.t-normal.t-black, .t-14.t-normal, .align-self-center span.t-14.t-normal') || {}).textContent || '';
            let title = cleanEntityField(norm(titleRaw));
            let company = cleanEntityField(norm(companyRaw));
            if (!company) {
              const alt = card.querySelector('.display-flex span[aria-hidden="true"]');
              if (alt) company = cleanEntityField(norm(alt.textContent || ''));
            }
            let dateRange = norm((card.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time') || {}).textContent || '');
            // Require valid dates for Experience entries
            if (!dateRange || !/(\d{4}|present)/i.test(dateRange)) return;
            if (GENERIC_SKILL_RE.test(company) || GENERIC_SKILL_RE.test(title)) return;
            if (company && title && company.toLowerCase() === title.toLowerCase() && !ORG_HINT_RE.test(company)) return;
            if (!(ORG_HINT_RE.test(company) || ORG_HINT_RE.test(title))) {
              const len = (company + ' ' + title).trim().length;
              if (len < 8) return;
            }
            if (title || company || dateRange) items.push({ company, title, dateRange });
          });
        }
      } catch {}
      return items;
    } catch { return []; }
  }

  // Quick SPA fallback: temporarily navigate to details/experience/ and harvest
  async function scrapeExperienceSPA(profileUrl) {
    // SPA nav disabled for speed
    if (!ALLOW_SPA_NAV) return [];
    try {
      const m = (profileUrl || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
      const base = m ? m[0] : '';
      const detailsUrl = base ? base + 'details/experience/' : '';
      if (!detailsUrl) return [];
      const orig = location.href;
      try {
        history.pushState({}, '', detailsUrl);
      } catch {}
      await waitForSelector('main, .pvs-list__container', 6000);
      await scrollUntilLoaded(document.scrollingElement || document.documentElement, 40, 220);
      const items = [];
      const cards = document.querySelectorAll('li, .pvs-list__paged-list-item, .artdeco-list__item');
      cards.forEach((card) => {
        const title = cleanEntityField(norm((card.querySelector('span[aria-hidden="true"], .mr1.t-bold span, .t-bold') || {}).textContent || ''));
        let company = cleanEntityField(norm((card.querySelector('.t-14.t-normal.t-black, .t-14.t-normal, .align-self-center span.t-14.t-normal') || {}).textContent || ''));
        if (!company) {
          const alt = card.querySelector('.display-flex span[aria-hidden="true"]');
          if (alt) company = cleanEntityField(norm(alt.textContent || ''));
        }
        let dateRange = norm((card.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time') || {}).textContent || '');
        if (!dateRange || !/(\d{4}|present)/i.test(dateRange)) return;
        if (GENERIC_SKILL_RE.test(company) || GENERIC_SKILL_RE.test(title)) return;
        if (company && title && company.toLowerCase() === title.toLowerCase() && !ORG_HINT_RE.test(company)) return;
        if (!(ORG_HINT_RE.test(company) || ORG_HINT_RE.test(title))) {
          const len = (company + ' ' + title).trim().length;
          if (len < 8) return;
        }
        if (title || company || dateRange) items.push({ company, title, dateRange });
      });
      try { history.pushState({}, '', orig); } catch {}
      return items;
    } catch { return []; }
  }

  function getEducation() {
    progress('education', 'collect');
    const out = [];
    try {
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (!h2 || !/education/i.test(h2.textContent || '')) continue;
        const items = qa('li, .pvs-list__paged-list-item, .artdeco-list__item', sec);
        for (const li of items) {
          // School name (bold line)
          let school = norm(text(q('.mr1.t-bold span[aria-hidden="true"], .t-bold span[aria-hidden="true"], .mr1.t-bold, .entity-result__primary-subtitle', li)));
          if (/\.png$|\.jpg$|\.jpeg$/i.test(school)) school = '';

          // Collect all secondary text lines under the card
          const secTexts = Array.from(li.querySelectorAll('.t-14.t-normal, .t-14.t-normal.t-black, .t-black--light, .pvs-entity__subtitle, .pv-entity__degree-name, .pv-entity__fos, .inline-show-more-text, span[aria-hidden="true"]'))
            .map(e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);

          // Extract date range
          let dateRange = norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time', li)));
          if (!dateRange) {
            const dt = secTexts.find(t => /\b(\d{4})\b.*?(\b(\d{4}|present)\b)/i.test(t));
            if (dt) dateRange = dt;
          }

          // Degree and field of study heuristics
          const DEGREE_PAT = /(b\.?\s?tech|btech|b\.?e\.?|bachelor|m\.?\s?tech|mtech|m\.?e\.?|master|mba|pgdm|diploma|ph\.?d\.?|doctorate|executive\s+program)/i;
          const SKILL_NOISE = /\b\+\d+\s*skills\b|\bRead more\b/i;
          let degreeParts = [];
          for (const t of secTexts) {
            if (SKILL_NOISE.test(t)) continue;
            if (DEGREE_PAT.test(t)) degreeParts.push(t);
          }
          // Prefer the shortest meaningful degree-like fragment
          degreeParts = degreeParts.sort((a,b) => a.length - b.length);
          let degree = degreeParts[0] || '';

          // Try to find a field of study if not already included
          let field = '';
          if (!/computer|information|electrical|mechanical|civil|science|engineering|technology|management/i.test(degree)) {
            const candidate = secTexts.find(t => /computer|information|electrical|mechanical|civil|science|engineering|technology|management/i.test(t));
            if (candidate && candidate.length < 80) field = candidate;
          }
          if (field && degree && !new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(degree)) {
            degree = `${degree}, ${field}`;
          }

          // Final cleanup and noise filtering
          degree = cleanEntityField((degree || '').replace(SKILL_NOISE, '').trim());
          school = cleanEntityField(school);
          // Require a valid date to prevent skills/people lists from leaking into Education
          if (!dateRange || !/(\d{4}|present)/i.test(dateRange)) { continue; }
          if (GENERIC_SKILL_RE.test(school) || GENERIC_SKILL_RE.test(degree)) { continue; }
          if (!(EDU_HINT_RE.test(school) || EDU_HINT_RE.test(degree))) continue;
          school = collapseDupSegments(school);
          degree = collapseDupSegments(degree);
          dateRange = collapseDupSegments(dateRange);
          if (school || degree || dateRange) out.push({ school, degree, dateRange });
        }
        break;
      }
    } catch (e) { console.warn('Education parse failed', e); }
    return out;
  }

  // Deep fallback: fetch Education details page
  async function scrapeEducationDeep(profileUrl) {
    // Disabled deep education fetch for speed
    try {
      const base = (profileUrl || '').replace(/\?.*$/, '').replace(/#.*$/, '');
      const rootUrl = base ? base : '';
      const url = rootUrl ? rootUrl + 'details/education/' : '';
      const items = [];
      if (!url) return items;
      try {
        const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 15000 });
        if (res.ok) {
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const root = doc.querySelector('main') || doc;
          const cards = root.querySelectorAll('li, .pvs-list__paged-list-item, .artdeco-list__item');
          // disabled parsing
          cards.forEach((card) => {
            // School (bold line)
            let school = cleanEntityField(norm((card.querySelector('.mr1.t-bold span[aria-hidden="true"], .t-bold span[aria-hidden="true"], .mr1.t-bold, .entity-result__primary-subtitle') || {}).textContent || ''));
            if (/\.(png|jpg|jpeg)$/i.test(school)) school = '';
            // Date range
            let dateRange = norm((card.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time') || {}).textContent || '');
            // Degree heuristics from secondary lines
            const secTexts = Array.from(card.querySelectorAll('.t-14.t-normal, .t-14.t-normal.t-black, .t-black--light, .pvs-entity__subtitle, .pv-entity__degree-name, .pv-entity__fos, .inline-show-more-text, span[aria-hidden="true"]'))
              .map(e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean);
            const DEGREE_PAT = /(b\.?\s?tech|btech|b\.?e\.?|bachelor|m\.?\s?tech|mtech|m\.?e\.?|master|mba|pgdm|diploma|ph\.?d\.?|doctorate|executive\s+program)/i;
            const SKILL_NOISE = /\b\+\d+\s*skills\b|\bRead more\b/i;
            let degreeParts = [];
            for (const t of secTexts) {
              if (SKILL_NOISE.test(t)) continue;
              if (DEGREE_PAT.test(t)) degreeParts.push(t);
            }
            degreeParts = degreeParts.sort((a,b) => a.length - b.length);
            let degree = degreeParts[0] || '';
            // Field of study
            let field = '';
            if (!/computer|information|electrical|mechanical|civil|science|engineering|technology|management/i.test(degree)) {
              const candidate = secTexts.find(t => /computer|information|electrical|mechanical|civil|science|engineering|technology|management/i.test(t));
              if (candidate && candidate.length < 80) field = candidate;
            }
            if (field && degree && !new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(degree)) {
              degree = `${degree}, ${field}`;
            }
            if (/\bExecutive Program\b/i.test(school) && !DEGREE_PAT.test(degree)) { degree = degree ? degree : school; school = ''; }
            degree = cleanEntityField((degree || '').replace(SKILL_NOISE, '').trim());
            // Require valid dates for Education entries
            if (!dateRange || !/(\d{4}|present)/i.test(dateRange)) return;
            if (GENERIC_SKILL_RE.test(school) || GENERIC_SKILL_RE.test(degree)) return;
            if (!(EDU_HINT_RE.test(school) || EDU_HINT_RE.test(degree))) return;
            school = collapseDupSegments(school);
            degree = collapseDupSegments(degree);
            dateRange = collapseDupSegments(dateRange);
            if (school || degree || dateRange) items.push({ school, degree, dateRange });
          });
        }
      } catch {}
      return items;
    } catch { return []; }
  }

  // Quick SPA fallback: temporarily navigate to details/education/ and harvest
  async function scrapeEducationSPA(profileUrl) {
    // SPA nav disabled for speed
    if (!ALLOW_SPA_NAV) return [];
    try {
      const m = (profileUrl || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
      const base = m ? m[0] : '';
      const detailsUrl = base ? base + 'details/education/' : '';
      if (!detailsUrl) return [];
      const orig = location.href;
      try {
        history.pushState({}, '', detailsUrl);
      } catch {}
      await waitForSelector('main, .pvs-list__container', 6000);
      await scrollUntilLoaded(document.scrollingElement || document.documentElement, 40, 220);
      const items = [];
      const cards = document.querySelectorAll('li, .pvs-list__paged-list-item, .artdeco-list__item');
      cards.forEach((card) => {
        let school = cleanEntityField(norm((card.querySelector('.mr1.t-bold span[aria-hidden="true"], .t-bold span[aria-hidden="true"], .mr1.t-bold, .entity-result__primary-subtitle') || {}).textContent || ''));
        if (/\.(png|jpg|jpeg)$/i.test(school)) school = '';
        let dateRange = norm((card.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time') || {}).textContent || '');
        const secTexts = Array.from(card.querySelectorAll('.t-14.t-normal, .t-14.t-normal.t-black, .t-black--light, .pvs-entity__subtitle, .pv-entity__degree-name, .pv-entity__fos, .inline-show-more-text, span[aria-hidden="true"]'))
          .map(e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        const DEGREE_PAT = /(b\.?\s?tech|btech|b\.?e\.?|bachelor|m\.?\s?tech|mtech|m\.?e\.?|master|mba|pgdm|diploma|ph\.?d\.?|doctorate|executive\s+program)/i;
        const SKILL_NOISE = /\b\+\d+\s*skills\b|\bRead more\b/i;
        let degreeParts = [];
        for (const t of secTexts) { if (!SKILL_NOISE.test(t) && DEGREE_PAT.test(t)) degreeParts.push(t); }
        degreeParts = degreeParts.sort((a,b) => a.length - b.length);
        let degree = degreeParts[0] || '';
        let field = '';
        if (!/computer|information|electrical|mechanical|civil|science|engineering|technology|management/i.test(degree)) {
          const candidate = secTexts.find(t => /computer|information|electrical|mechanical|civil|science|engineering|technology|management/i.test(t));
          if (candidate && candidate.length < 80) field = candidate;
        }
        if (field && degree && !new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(degree)) degree = `${degree}, ${field}`;
        if (/\bExecutive Program\b/i.test(school) && !DEGREE_PAT.test(degree)) { degree = degree ? degree : school; school = ''; }
        degree = cleanEntityField((degree || '').replace(SKILL_NOISE, '').trim());
        if (!dateRange || !/(\d{4}|present)/i.test(dateRange)) return;
        if (GENERIC_SKILL_RE.test(school) || GENERIC_SKILL_RE.test(degree)) return;
        if (!(EDU_HINT_RE.test(school) || EDU_HINT_RE.test(degree))) return;
        school = collapseDupSegments(school);
        degree = collapseDupSegments(degree);
        dateRange = collapseDupSegments(dateRange);
        if (school || degree || dateRange) items.push({ school, degree, dateRange });
      });
      try { history.pushState({}, '', orig); } catch {}
      return items;
    } catch { return []; }
  }

  function getCertifications() {
    progress('certifications', 'collect');
    const out = [];
    try {
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (!h2 || !/(licenses?\s*&?\s*certifications?|certifications?)/i.test(h2.textContent || '')) continue;
        const items = qa('li, .pvs-list__paged-list-item, .artdeco-list__item, .pvs-entity, .display-flex', sec);
        for (const li of items) {
          let name = cleanEntityField(norm(text(q('.mr1.t-bold span[aria-hidden="true"], .t-bold span[aria-hidden="true"], span[aria-hidden="true"], .mr1.t-bold', li))));
          let issuer = cleanEntityField(norm(text(q('.t-14.t-normal.t-black, .t-14.t-normal, .t-black--light, .entity-result__primary-subtitle, .pv-certifications-entity__issuer', li))));
          let date = cleanEntityField(norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time', li))));

          if (!name && !issuer && !date) continue;
          // Strip "+N skills" and similar tails often appended in preview rows
          issuer = issuer.replace(/\s*(?:and\s*)?\+\d+\s*skills?\b.*$/i, '').trim();
          // Final clean
          if (GENERIC_SKILL_RE.test(name) || GENERIC_SKILL_RE.test(issuer)) continue;
          name = collapseDupSegments(name);
          issuer = collapseDupSegments(issuer);
          date = collapseDupSegments(date);
          if (name || issuer || date) out.push({ name, issuer, date });
        }
        break;
      }
    } catch (e) {
      console.warn('Certifications parse failed', e);
    }
    // Dedupe by name+issuer+date
    const key = (x) => [x.name || '', x.issuer || '', x.date || ''].join(' | ').toLowerCase();
    const seen = new Set();
    const deduped = [];
    out.forEach((x) => { const k = key(x); if (k && !seen.has(k)) { seen.add(k); deduped.push(x); } });
    return deduped;
  }

  async function scrapeBasics() {
    // Ensure top of page has rendered
    await waitForSelector('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .artdeco-entity-lockup__title span[dir]', 8000);
    await autoScroll();

    // Name
    let name = '';
    const nameNode = q('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .artdeco-entity-lockup__title span[dir], div.ph5 h1');
    name = norm(text(nameNode));

    // Headline disabled for performance
    let headline = '';

    // About
    let about = norm(getAboutSection());

    // Profile picture (safe selectors with fallbacks)
    let profilePic = '';
    try {
      // Prefer explicit avatar nodes to avoid picking random media/images
      const picSel = [
        'img.pv-top-card-profile-picture__image',
        'img.pv-top-card-profile-picture__image--show',
        'img[data-test-id="hero-summary-card-profile-image"]',
        'img[alt*="profile" i][src*="media"], img[alt*="Profile" i][src*="media"]',
      ];
      for (const sel of picSel) {
        const node = q(sel);
        const src = node ? (node.currentSrc || node.src || node.getAttribute('data-delayed-url') || '') : '';
        if (src && /^https?:\/\//i.test(src)) { profilePic = src; break; }
      }
    } catch {}

    // Fallbacks via meta if missing
    if (!name) {
      const meta = metaFallbackNameHeadline();
      if (!name && meta.name) name = norm(meta.name);
    }

    // Final fallback: derive name from URL slug if still missing
    if (!name) {
      try {
        const slug = (location.pathname.match(/\/in\/([^/]+)\/?/) || [,''])[1];
        if (slug) {
          name = slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
        }
      } catch {}
    }

    // Connection degree (e.g., 1st, 2nd)
    let connectionDegree = '';
    try {
      const connNode = q('.dist-value, .pv-top-card--list-bullet li');
      const raw = norm(text(connNode));
      if (/\b(?:1st|2nd|3rd|[4-9]th)\b/i.test(raw)) {
        const m = raw.match(/\b(1st|2nd|3rd|[4-9]th)\b/i);
        connectionDegree = m ? m[1].toLowerCase() : '';
      } else if (/degree\s+connection/i.test(raw)) {
        connectionDegree = raw.replace(/.*?(\b\d+(?:st|nd|rd|th)\b).*?/i, '$1').toLowerCase();
      }
    } catch {}

    return { name, headline, about, profilePic, connectionDegree };
  }

  async function scrapeContactInfo(includeContact) {
    if (!includeContact) return null;
    try {
      const data = { websites: [], emails: [], phones: [] };

      const pushEmail = (s) => { if (s) data.emails.push(s.trim()); };
      const pushPhone = (s) => { if (s) data.phones.push(s.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-')); };
      const pushSite = (s) => { if (s) data.websites.push(s.trim()); };

      const harvestFromRoot = (root) => {
        // Only within explicit contact containers to avoid noise
        const scope = root || document;
        // Emails
        scope.querySelectorAll('a[href^="mailto:"], .pv-contact-info__contact-type.ci-email a, a[data-control-name*="email"]')
          .forEach((a) => pushEmail((a.getAttribute('href') || '').replace(/^mailto:/i, '')));
        // Phones
        scope.querySelectorAll('a[href^="tel:"], .pv-contact-info__contact-type.ci-phone a, a[data-control-name*="phone"]')
          .forEach((a) => pushPhone((a.getAttribute('href') || '').replace(/^tel:/i, '')));
        // Websites
        scope.querySelectorAll('.pv-contact-info__contact-type.ci-websites a, a[href^="http"], a[href^="https"]')
          .forEach((a) => pushSite((a.getAttribute('href') || '').trim()));
      };

      const uniq = (arr) => Array.from(new Set((arr || []).map((s) => (s || '').trim()).filter(Boolean)));

      // 1) Fetch-first: overlay/contact-info (server-rendered, robust)
      try {
        const m = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
        const base = m ? m[0] : '';
        const url = base ? base + 'overlay/contact-info/' : '';
        if (url) {
          const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 6000 });
          if (res.ok) {
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const root = doc.querySelector('.pv-contact-info, .pv-contact-info__container, main, body') || doc;
            harvestFromRoot(root);
          }
        }
      } catch {}

      // If still empty, 2) Click the Contact info button and parse modal
      if (!data.emails.length && !data.phones.length && !data.websites.length) {
        try {
          const btn = document.querySelector(
            'a[href*="overlay/contact-info"], a[data-control-name*="contact_see_more" i], a[aria-label*="Contact" i], a[href*="contact-info" i]'
          );
          if (btn) {
            await clickIfExists(btn);
            await sleep(600);
            const modal = document.querySelector('.pv-contact-info, .artdeco-modal, .pv-contact-info__container') || document;
            harvestFromRoot(modal);
            // Close
            const close = modal.querySelector('button[aria-label*="Dismiss" i], button[aria-label*="Close" i], .artdeco-modal__dismiss');
            try { close && (close instanceof HTMLElement) && close.click(); } catch {}
          }
        } catch {}
      }

      // Post-process: de-dup and filter
      data.emails = uniq(data.emails).filter((e) => /@/.test(e));
      data.phones = uniq(data.phones).map((p) => p.replace(/[^+\d\-()\s]/g, '').replace(/\s+/g, ' ').trim());
      data.websites = uniq(data.websites).filter((u) => /^https?:\/\//i.test(u));

      // sanitize websites: only http(s). For linkedin.com, only keep this profile's own /in/<slug> URL.
      let profileSlug = '';
      try {
        const m2 = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/([^/]+)\//);
        if (m2 && m2[1]) profileSlug = m2[1].toLowerCase();
      } catch {}
      data.websites = uniq(data.websites).filter((u) => /^https?:\/\//i.test(u)).filter((u) => {
        try {
          const { hostname, pathname } = new URL(u);
          if (/linkedin\.com$/i.test(hostname)) {
            if (profileSlug) return /\/in\//i.test(pathname) && pathname.toLowerCase().includes(profileSlug);
            return false;
          }
          return true;
        } catch { return false; }
      });

      return data;
    } catch (e) {
      console.warn('Contact info scrape failed', e);
      return null;
    }
  }

  async function scrapeSkills(includeSkills) {
    if (!includeSkills) return [];
    const skills = new Set();

    function cleanSkillName(name) {
      let s = (name || '').replace(/\s+/g, ' ').trim();
      // Remove duplicated words like "User JourneysUser Journeys"
      s = s.replace(/^(.*?)\1$/i, '$1').trim();
      // Drop noisy rows like "2 experiences across ..."
      if (/\b\d+\s+experiences?\b/i.test(s)) return '';
      // Drop company/position context lines
      if ((/\b(at|across)\b/i.test(s) && s.length > 30)) return '';
      // Reject mostly numeric or punctuation
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[A-Za-z]/g) || []).length;
      if (!letters || digits > letters) return '';
      return s;
    }

    const harvestList = (root) => {
      qa('li, .pvs-list__paged-list-item, .artdeco-list__item', root).forEach((li) => {
        const name = cleanSkillName(text(q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)));
        if (name) skills.add(name);
      });
      // Also parse inline bullet previews
      qa('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]', root)
        .forEach((el) => splitSkillsInline(el.textContent).forEach((s) => {
          const n = cleanSkillName(s);
          if (n) skills.add(n);
        }));
    };

    try {
      // 1) Fetch details/skills HTML first (fastest and avoids SPA nav)
      try {
        const m = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
        const base = m ? m[0] : '';
        const url = base ? base + 'details/skills/' : '';
        if (url) {
          const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 15000 });
          if (res.ok) {
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const root = doc.querySelector('main') || doc;
            harvestList(root);
          }
        }
      } catch (e) { console.warn('Fetch-first details/skills failed', e); }

      // 2) Try section + modal in-page
      let skillsSection = null;
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (h2 && /skills/i.test(h2.textContent)) { skillsSection = sec; break; }
      }
      if (skillsSection) {
        // Click "Show all" or details link
        let openBtn = qa('a, button, [role="button"]', skillsSection).find((b) => {
          const t = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
          const href = b.getAttribute && (b.getAttribute('href') || '');
          return /show\s+all|show\s+more|skills/i.test(t) || /details\/skills/i.test(href || '');
        });
        if (openBtn) {
          await clickIfExists(openBtn);
          const modal = await waitForSelector('.artdeco-modal[role="dialog"], .pvs-modal__container, .artdeco-modal', 10000);
          if (modal) {
            const scrollHost = q('.artdeco-modal__content, .pvs-modal__content, [role="dialog"]', modal) || modal;
            await scrollUntilLoaded(scrollHost, 60, 300);
            harvestList(modal);
            const close = q('button[aria-label*="Dismiss" i], button.artdeco-modal__dismiss, button[aria-label*="Close" i]', modal);
            try { close && (close instanceof HTMLElement) && close.click(); } catch {}
          }
        }
        if (!skills.size) harvestList(skillsSection);
        // Try an explicit top-skills overlay button/link
        let openTopBtn = qa('a, button, [role="button"]', skillsSection).find((b) => {
          const t = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
          const href = b.getAttribute && (b.getAttribute('href') || '');
          return /top\s+skills|show\s+top/i.test(t) || /overlay\/top-skills|details\/skills/i.test(href || '');
        });
        if (openTopBtn) {
          await clickIfExists(openTopBtn);
          const modal = await waitForSelector('.artdeco-modal[role="dialog"], .pvs-modal__container, .artdeco-modal', 10000);
          if (modal) {
            const scrollHost = q('.artdeco-modal__content, .pvs-modal__content, [role="dialog"]', modal) || modal;
            await scrollUntilLoaded(scrollHost, 60, 300);
            // If there is a top skills subheader inside modal, prefer it
            const topHdr = qa('h2, h3, .t-bold', modal).find((h) => /top\s+skills/i.test((h.textContent || '')));
            const root = topHdr ? topHdr.closest('section, div') || modal : modal;
            harvestList(root);
            const close = q('button[aria-label*="Dismiss" i], button.artdeco-modal__dismiss, button[aria-label*="Close" i]', modal);
            try { close && (close instanceof HTMLElement) && close.click(); } catch {}
          }
        }
      }

      // 3) As last resort, a very quick SPA overlay attempt
      if (ALLOW_SPA_NAV && !skills.size) {
        try {
          const m = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
          const base = m ? m[0] : '';
          const detailsUrl = base ? base + 'details/skills/' : '';
          if (detailsUrl) {
            const orig = location.href;
            history.pushState({}, '', detailsUrl);
            await waitForSelector('main, .pvs-list__container', 8000);
            const root = q('main') || document;
            await scrollUntilLoaded(document.scrollingElement || document.documentElement, 40, 220);
            harvestList(root);
            try { history.pushState({}, '', orig); } catch {}
          }
        } catch (e) { console.warn('Skills quick SPA failed', e); }
      }
    } catch (e) {
      console.warn('Skills scrape failed:', e);
    }
    // Cap to 5 skills max
    return Array.from(skills).slice(0, 5);
  }

  async function scrapeTopSkills(includeSkills) {
    // Top skills disabled for speed
    return [];
  }

  async function scrapeAll(options) {
    progress('init');
    await waitForSelector('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .artdeco-entity-lockup__title span[dir]', 5000);
    await autoScroll(4);

    const profileUrl = getProfileUrl();
    let basics = { name: '', headline: '', about: '', profilePic: '', connectionDegree: '' };
    let experience = [];
    let education = [];
    let licenses = [];
    let contactInfo = null;
    let skills = [];

    // Basics
    progress('basics');
    basics = await runWithStepTimeout('basics', () => scrapeBasics(), 12000, { name: '', about: '', profilePic: '', connectionDegree: '' });

    // Quick visibility pass to prompt lazy-load of sections (non-blocking)
    try { ensureSectionVisible(/experience/i, 4); } catch {}
    try { ensureSectionVisible(/education/i, 4); } catch {}
    try { ensureSectionVisible(/certifications?|licenses?/i, 4); } catch {}
    if (options && options.includeSkills) { try { ensureSectionVisible(/skills/i, 4); } catch {} }

    // Harvest in parallel with tight per-step timeouts
    const tasks = [];
    tasks.push(runWithStepTimeout('experience', () => getExperience(), 5000, []));
    tasks.push(runWithStepTimeout('education', () => getEducation(), 5000, []));
    tasks.push(runWithStepTimeout('certifications', () => getCertifications(), 4000, []));
    if (options && options.includeSkills) {
      tasks.push(runWithStepTimeout('skills', () => scrapeSkillsFast(), 3000, []));
    } else {
      tasks.push(Promise.resolve([]));
    }
    tasks.push(runWithStepTimeout('contact', () => scrapeContactInfoFast(!!(options && options.includeContact)), 5000, null));

    const [expRes, eduRes, licRes, skillsRes, contactRes] = await Promise.all(tasks);
    experience = Array.isArray(expRes) ? expRes : [];
    education = Array.isArray(eduRes) ? eduRes : [];
    licenses = Array.isArray(licRes) ? licRes : [];
    skills = Array.isArray(skillsRes) ? skillsRes.slice(0, 5) : [];
    contactInfo = contactRes || null;

    // Last-resort inline skills if empty
    if ((options && options.includeSkills) && (!skills || !skills.length)) {
      try {
        const bullets = qa('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]');
        const collected = new Set();
        bullets.forEach(el => splitSkillsInline(el.textContent).forEach(s => collected.add(s)));
        skills = Array.from(collected).slice(0, 5);
      } catch {}
    }

    return {
      profileUrl,
      name: basics.name,
      about: basics.about,
      profilePic: basics.profilePic || '',
      connectionDegree: basics.connectionDegree || '',
      experience,
      education,
      licenses,
      contactInfo,
      skills,
      scrapedAt: new Date().toISOString(),
      complete: true,
    };
  }

  async function scrollUntilLoaded(container, maxLoops = 50, delay = 300) {
    try {
      let prevHeight = -1;
      for (let i = 0; i < maxLoops; i++) {
        container.scrollTop = container.scrollHeight;
        await sleep(delay);
        const cur = container.scrollHeight;
        if (cur === prevHeight) break;
        prevHeight = cur;
      }
    } catch {}
  }

  // Quickly bring a section into view so LinkedIn lazy-loads its items
  async function ensureSectionVisible(headingRegex, maxHops = 10) {
    try {
      const findSec = () => {
        const sections = qa('section');
        for (const sec of sections) {
          const h2 = q('h2, h3', sec);
          if (h2 && headingRegex.test(h2.textContent || '')) return sec;
        }
        return null;
      };
      let sec = findSec();
      if (sec) {
        sec.scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(200);
        try { await expandWithin(sec); } catch {}
        return true;
      }
      // Hop-scroll until found or out of hops
      for (let i = 0; i < maxHops; i++) {
        window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.8)));
        await sleep(160);
        sec = findSec();
        if (sec) {
          sec.scrollIntoView({ behavior: 'auto', block: 'center' });
          await sleep(200);
          try { await expandWithin(sec); } catch {}
          return true;
        }
      }
    } catch {}
    return false;
  }

  async function scrapeLicensesDeep(profileUrl) {
    try {
      const base = (profileUrl || '').replace(/\/recent-activity.*$/, '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
      const rootUrl = base ? base[0] : '';
      const url = rootUrl ? rootUrl + 'details/certifications/' : '';
      const items = [];
      if (!url) return items;
      try {
        const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 15000 });
        if (res.ok) {
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const root = doc.querySelector('main') || doc;
          const cards = root.querySelectorAll('li, .pvs-list__paged-list-item, .artdeco-list__item');
          cards.forEach((card) => {
            const title = norm((card.querySelector('span[aria-hidden="true"], .mr1.t-bold span, .t-bold') || {}).textContent || '');
            const subtitle = norm((card.querySelector('.t-normal, .t-14.t-normal, .t-black--light, .display-flex span[aria-hidden="true"]') || {}).textContent || '');
            const dates = norm((card.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time') || {}).textContent || '');
            const description = norm((card.querySelector('.pv-entity__extra-details, .pvs-list__outer-container p, .inline-show-more-text') || {}).textContent || '');
            if (title || subtitle || dates || description) items.push({ title, subtitle, dates, description });
          });
        }
      } catch {}
      return items;
    } catch { return []; }
  }

  async function scrapeLicensesSPA(profileUrl) {
    try {
      const base = (profileUrl || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
      const rootUrl = base ? base[0] : '';
      const url = rootUrl ? rootUrl + 'details/certifications/' : '';
      if (!url) return [];
      const orig = location.href;
      try {
        history.pushState({}, '', url);
      } catch {}
      await waitForSelector('main, .pvs-list__container', 6000);
      await scrollUntilLoaded(document.scrollingElement || document.documentElement, 40, 220);
      const res = getCertifications();
      try { history.pushState({}, '', orig); } catch {}
      return res;
    } catch (e) {
      console.warn('Licenses SPA failed', e);
      return [];
    }
  }

  // --- Lightweight DOM helpers per request ---
  function getAboutSection() {
    // Prefer explicit About containers
    const aboutRoots = [
      document.querySelector('section#about'),
      document.querySelector('section.pv-about-section'),
      document.querySelector('[data-test-id="about"]'),
      Array.from(document.querySelectorAll('section')).find(sec =>
        /\babout\b/i.test((sec.getAttribute('id') || sec.innerText || ''))
      )
    ].filter(Boolean);

    for (const root of aboutRoots) {
      try { expandWithin(root); } catch {}

      // Click "See more" if exists
      try {
        const btn = root.querySelector('button[aria-label*="see more" i], button[aria-label*="show more" i], .inline-show-more-text__button');
        if (btn && (btn instanceof HTMLElement)) { btn.click(); }
      } catch {}

      // Collect About text with extended selectors for new DOM
      const chunks = Array.from(root.querySelectorAll(
        'p, .lt-line-clamp__line, .lt-line-clamp__raw-line, span[aria-hidden="true"], .inline-show-more-text, .pvs-list__outer-container p'
      ))
        .map(n => (n.innerText || n.textContent || '').trim())
        .filter(Boolean);

      const txt = cleanAboutText(chunks.join(' ').trim());
      if (txt) return txt;
    }

    // Fallback: search by heading "About"
    try {
      const hdr = Array.from(document.querySelectorAll('h2, h3')).find(h => /\babout\b/i.test((h.textContent || '')));
      if (hdr) {
        const host = hdr.closest('section, div') || document;
        const p = host.querySelector('p, .lt-line-clamp__raw-line, .lt-line-clamp__line, .pvs-list__outer-container p');
        const alt = cleanAboutText((p && (p.innerText || p.textContent) || '').trim());
        if (alt) return alt;
      }
    } catch {}
    return '';
  }

  async function fetchAboutFromProfile(profileUrl) {
    try {
      const base = (profileUrl || '').replace(/\?.*$/, '').replace(/#.*$/, '');
      const res = await fetchWithTimeout(base, { credentials: 'include', timeout: 15000 });
      if (!res.ok) return '';
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const aboutRoots = [
        doc.querySelector('section#about'),
        doc.querySelector('section.pv-about-section'),
        doc.querySelector('[data-test-id="about"]'),
        Array.from(doc.querySelectorAll('section')).find(sec =>
          /\babout\b/i.test((sec.getAttribute('id') || sec.innerText || ''))
        )
      ].filter(Boolean);
      for (const root of aboutRoots) {
        const chunks = Array.from(root.querySelectorAll('p, .lt-line-clamp__line, .lt-line-clamp__raw-line, span[aria-hidden="true"]'))
          .map(n => (n.innerText || n.textContent || '').trim())
          .filter(Boolean);
        const txt = cleanAboutText(chunks.join(' ').trim());
        if (txt) return txt;
      }
    } catch {}
    return '';
  }

  async function fetchAboutFromDetails(profileUrl) {
    try {
      const m = (profileUrl || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
      const root = m ? m[0] : '';
      const url = root ? root + 'details/about/' : '';
      if (!url) return '';
      const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 16000 });
      if (!res.ok) return '';
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const candidates = [
        doc.querySelector('section#about'),
        doc.querySelector('main'),
        doc.body
      ].filter(Boolean);
      for (const rootEl of candidates) {
        const nodes = rootEl.querySelectorAll('p, .lt-line-clamp__raw-line, .lt-line-clamp__line, span[aria-hidden="true"], .inline-show-more-text');
        const textParts = Array.from(nodes).map(n => (n.innerText || n.textContent || '').trim()).filter(Boolean);
        const txt = cleanAboutText(textParts.join(' ').trim());
        if (txt) return txt;
      }
    } catch {}
    return '';
  }

  function getTopSkills() {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('.pv-skill-category-entity__name-text, .t-bold').forEach((el) => {
      const skill = (el.innerText || el.textContent || '').trim();
      if (skill && !seen.has(skill)) { seen.add(skill); out.push(skill); }
    });
    // Also parse inline bullet list preview near Top skills
    document.querySelectorAll('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]').forEach((el) => {
      splitSkillsInline(el.textContent).forEach((s) => { if (!seen.has(s)) { seen.add(s); out.push(s); } });
    });
    return out;
  }

  function cleanAboutText(txt) {
    if (!txt) return '';
    let s = (txt || '').replace(/\s+/g, ' ').trim();
    // Split into sentences on punctuation boundaries
    const sentences = s.split(/(?<=[.!?])\s+/);
    const seen = new Set();
    const out = [];
    for (let sen of sentences) {
      const t = (sen || '').trim();
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out.join(' ');
  }

  function collapseDupSegments(s) {
    s = norm(s);
    if (!s) return s;
    // Remove exact double concatenation (e.g., "ABCABC")
    const mid = Math.floor(s.length / 2);
    if (s.length % 2 === 0 && s.slice(0, mid) === s.slice(mid)) return s.slice(0, mid).trim();
    // Split by common separators and remove adjacent duplicates
    const seps = [' · ', ' | ', ' – ', ' - '];
    for (const sep of seps) {
      if (s.includes(sep)) {
        const parts = s.split(sep).map(p => norm(p)).filter(Boolean);
        const out = [];
        for (const p of parts) if (out[out.length - 1] !== p) out.push(p);
        return out.join(sep);
      }
    }
    return s;
  }

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  function findEmails(str) {
    const set = new Set();
    (str.match(EMAIL_RE) || []).forEach(e => set.add(e.toLowerCase()));
    return Array.from(set);
  }

  const PHONE_CANDIDATE_RE = /(?:(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d[\d\s\-()]{8,})/g;
  function sanitizePhone(p) {
    const digits = (p.match(/\d/g) || []).join('');
    if (digits.length < 10 || digits.length > 15) return '';
    // Reject if the string clearly looks like a date range near years
    if (/\b(19|20)\d{2}\b.*?-.*?\b(19|20)\d{2}\b/.test(p)) return '';
    // Normalize: keep leading + and digits
    const plus = p.trim().startsWith('+') ? '+' : '';
    return plus + digits;
  }
  function findPhones(str) {
    const set = new Set();
    (str.match(PHONE_CANDIDATE_RE) || []).forEach(raw => {
      const s = sanitizePhone(raw);
      if (s) set.add(s);
    });
    return Array.from(set);
  }

  // --- Noise filtering helpers for list sections ---
  const GARBAGE_RE = /(endorsement|endorsed by|second\s+degree\s+connection|third\s+degree\s+connection|send\s+profile\s+in\s+a\s+message|save\s+to\s+pdf|request\s+a\s+recommendation|recommend\b|unfollow\b|remove\s+connection|report\s*\/\s*block|about\s+this\s+profile|privacy\s*&?\s*terms|ad\s+choices|careers|marketing\s+solutions|sales\s+solutions|mobile|small\s+business|safety\s+center|questions\?|manage\s+your\s+account|professional\s+community\s+policies|talent\s+solutions)/i;
  const DEGREE_BADGE_RE = /^\s*(?:·\s*)?\d+(?:st|nd|rd|th)\b/i;
  const GENERIC_SKILL_RE = /^(management|telecommunications|market\s+research|competitive\s+analysis|team\s+management|software\s+development|e-?commerce|start-?ups?|leadership|business\s+intelligence|product\s+marketing|analytics|html(?:\s*\+\s*css)?|software\s+project\s+management|online\s+marketing|marketing\s+strategy|operations\s+management|analysis|marketing\s+research|customer\s+relations|competitive\s+intelligence|consulting|strategic\s+planning|team\s+leadership|strategy|seo|customer\s+acquisition|integration|software\s+engineering|business\s+relations|business\s+information|product\s+development|networking|crm|management\s+consulting|vendor\s+management|testing|online\s+business\s+optimization|telecommunication\s+industry|software\s+design|web\s+project\s+management|search\s+engine\s+positioning|direct\s+marketing|business\s+research|customer\s+service|training)$/i;
  const ORG_HINT_RE = /(\b(ltd|llc|gmbh|inc|corp|co\.?|pvt|plc|technologies|solutions|systems|labs|software|consulting|university|college|institute|school|academy|group|holding|enterprises?)\b|\bat\b)/i;
  const EDU_HINT_RE = /(university|college|institute|school|academy|iit|nit|iiit|mit|oxford|cambridge|bachelor|master|mba|b\.?e\.?|b\.?tech|m\.?e\.?|m\.?tech|pgdm|ph\.?d\.?|diploma)/i;
  function hasEnoughLetters(s) {
    const v = (s || '').replace(/\s+/g, ' ').trim();
    const letters = (v.match(/[a-z]/gi) || []).length;
    const digits = (v.match(/\d/g) || []).length;
    return letters >= 2 && (letters >= digits || letters >= 4);
  }
  function cleanEntityField(s) {
    let v = (s || '').replace(/\s+/g, ' ').trim();
    if (!v) return '';
    if (GARBAGE_RE.test(v)) return '';
    if (DEGREE_BADGE_RE.test(v)) return '';
    if (/^(home|messaging|notifications)$/i.test(v)) return '';
    if (!hasEnoughLetters(v)) return '';
    return v;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PING') { sendResponse({ type: 'PONG' }); return; }
    if (msg && msg.type === 'DO_SCRAPE') {
      (async () => {
        try {
          const data = await withOverallTimeout(scrapeAll(msg.options || {}), 20000);
          progress('done');
          // Return partial data even if name not found; popup can show warning
          sendResponse({ ok: true, data });
        } catch (e) {
          console.error('Scrape fatal error:', e);
          progress('error', e && e.message ? e.message : String(e));
          sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
        }
      })();
      return true;
    }
    // Lightweight data fetch without full scrape
    if (msg && (msg.action === 'getProfileData')) {
      try {
        sendResponse({
          ok: true,
          data: {
            skills: (function(){
              try {
                const bullets = qa('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]');
                const s = new Set();
                bullets.forEach(el => splitSkillsInline(el.textContent).forEach(x => s.add(x)));
                return Array.from(s).slice(0, 5);
              } catch { return []; }
            })(),
            about: getAboutSection(),
          },
        });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
      return true;
    }
  });

  const ALLOW_SPA_NAV = false;

  // Port-based long-lived messaging for robust large-profile scraping (inside IIFE so it can use helpers)
  try {
    chrome.runtime.onConnect.addListener((port) => {
      if (!port || port.name !== 'scrape-port') return;
      let aborted = false;

      const safePost = (msg) => { try { port.postMessage(msg); } catch {} };

      port.onDisconnect.addListener(() => { aborted = true; });

      port.onMessage.addListener(async (msg) => {
        if (!msg || msg.type !== 'START_SCRAPE') return;
        const options = msg.options || {};
        safePost({ type: 'PROGRESS', step: 'init', detail: 'starting' });
        try {
          const wot = (typeof withOverallTimeout === 'function') ? withOverallTimeout : function(promise, timeoutMs){
            return new Promise((resolve, reject) => {
              let done = false;
              const timer = setTimeout(() => {
                if (done) return; done = true;
                reject(new Error(`Scrape operation timed out after ${Math.round(timeoutMs/1000)}s`));
              }, timeoutMs);

              Promise.resolve(promise).then((res) => {
                if (done) return; done = true; clearTimeout(timer); resolve(res);
              }).catch((err) => {
                if (done) return; done = true; clearTimeout(timer); reject(err);
              });
            });
          };
          const data = await wot(scrapeAll(options), 20000);
          if (aborted) return;
          try {
            chrome.storage.session.set({ lastScrape: data }, () => {
              if (chrome.runtime.lastError) {
                chrome.storage.local.set({ lastScrape: data }, () => {});
              }
            });
          } catch {}
          safePost({ type: 'PROGRESS', step: 'done', detail: 'complete', partialKey: 'lastScrape', partialData: data });
          safePost({ type: 'RESULT', ok: true, data });
          setTimeout(() => { try { port.disconnect(); } catch {} }, 300);
        } catch (e) {
          if (aborted) return;
          safePost({ type: 'ERROR', error: e && e.message ? e.message : String(e) });
        }
      });
    });
  } catch {}

  // Fast skills: in-page only, no clicks, no waits; cap to 5
  async function scrapeSkillsFast() {
    const set = new Set();
    try {
      // Visible skill rows (Skills section only)
      const skillsSection = (function(){
        const sections = qa('section');
        for (const sec of sections) {
          const h2 = q('h2, h3', sec);
          if (h2 && /\bskills\b/i.test(h2.textContent || '')) return sec;
        }
        return null;
      })();

      const CERT_WORD_RE = /(certified|certification|certificate|rhcsa|aws\s+certified|oracle\s+certified|microsoft\s+certified|foundation\s+certificate)/i;
      const META_WORD_RE = /(issuer|issued|university|college|institute|academy|location|based\s+in|currently)/i;
      const GEO_RE = /(jaipur|kota|india|delhi|mumbai|bangalore|bengaluru|pune|gurgaon|noida|hyderabad)/i;
      const SENTENCE_TOKEN_RE = /(\.|,|;|:\s|\bi\b|\bmy\b|\bi'm\b|\bi am\b|\bwith\b|\band\b|\bthat\b|\bwhich\b)/i;

      const plausibleSkill = (v) => {
        let s = (v || '').replace(/\s+/g, ' ').trim();
        if (!s || s.length < 2) return '';
        // Obvious noise
        if (/\b\+\d+\s*skills\b/i.test(s)) return '';
        if (/\b\d+\s+experiences?\b/i.test(s)) return '';
        // Drop cert/meta/geo/sentence-like
        if (CERT_WORD_RE.test(s)) return '';
        if (META_WORD_RE.test(s)) return '';
        if (GEO_RE.test(s)) return '';
        if (SENTENCE_TOKEN_RE.test(s) && s.length > 20) return '';
        // Word-count and length bounds
        const words = s.split(/\s+/).filter(Boolean);
        if (words.length > 3) return '';
        if (s.length > 35) return '';
        // Character balance
        const digits = (s.match(/\d/g) || []).length;
        const letters = (s.match(/[A-Za-z]/g) || []).length;
        if (!letters || digits > letters) return '';
        // Avoid generic labels only
        if (/^(skills?|top|other|more)$/i.test(s)) return '';
        return s;
      };

      if (skillsSection) {
        qa('li, .pvs-list__paged-list-item, .artdeco-list__item', skillsSection).forEach((li) => {
          const raw = (q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)?.textContent || '').replace(/\s+/g, ' ').trim();
          const skill = plausibleSkill(raw);
          if (skill) set.add(skill);
        });
      }

      // Strict inline-bullets fallback if section yields <5
      if (set.size < 5) {
        try {
          const bullets = qa('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"], .pv-top-card .inline-show-more-text span[aria-hidden="true"]');
          bullets.forEach((el) => {
            splitSkillsInline(el.textContent).forEach((s) => {
              const cleaned = plausibleSkill(s);
              if (cleaned) set.add(cleaned);
            });
          });
        } catch {}
      }
    } catch {}
    return Array.from(set).slice(0, 5);
  }
})();
