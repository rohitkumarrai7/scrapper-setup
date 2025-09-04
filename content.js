// content.js
// MV3 content script for LinkedIn profile scraping

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const text = (el) => (el ? el.textContent.trim() : '');

  // Progress ping to popup
  function progress(step, detail) {
    try { chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', step, detail }); } catch {}
  }

  // Send partial data to background so popup can retrieve last known good data
  function sendPartial(section, data) {
    try { chrome.runtime.sendMessage({ type: 'PARTIAL_DATA', section, data }); } catch (e) { /* ignore */ }
  }

  // Overall timeout wrapper for the whole scrape
  function withOverallTimeout(promise, ms = 120000) {
    let t;
    return Promise.race([
      promise,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('overall-timeout')), ms); })
    ]).finally(() => clearTimeout(t));
  }

  // Run a specific step with its own timeout so one slow step doesn't kill the whole scrape
  async function runWithStepTimeout(stepName, fn, ms = 15000, fallbackValue = null) {
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
    const { timeout = 20000, ...rest } = opts || {};
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

  async function autoScroll(maxSteps = 24) {
    let last = 0;
    for (let i = 0; i < maxSteps; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(400);
      const cur = document.body.scrollHeight;
      if (cur === last) break;
      last = cur;
    }
    window.scrollTo(0, 0);
    await sleep(300);
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
            if (!headline && data.headline) headline = data.headline;
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
            const subtitle = norm(text(q('.t-normal, .t-14.t-normal, .t-black--light, .display-flex span[aria-hidden="true"]', card)));
            const dates = norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, .t-12.t-black--light', card)));
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
          const title = norm(text(q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)));
          // Company line often in a secondary line
          let company = norm(text(q('.t-14.t-normal.t-black, .t-14.t-normal, .align-self-center span.t-14.t-normal', li)));
          if (!company) {
            const alt = q('.display-flex span[aria-hidden="true"]', li);
            if (alt) company = norm(text(alt));
          }
          const dateRange = norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time', li)));
          if (title || company || dateRange) out.push({ company, title, dateRange });
        }
        break;
      }
    } catch (e) { console.warn('Experience parse failed', e); }
    return out;
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
          const school = norm(text(q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)));
          const degree = norm(text(q('.t-14.t-normal, .pv-entity__degree-name, .t-14.t-normal.t-black', li)));
          const dateRange = norm(text(q('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, time', li)));
          if (school || degree || dateRange) out.push({ school, degree, dateRange });
        }
        break;
      }
    } catch (e) { console.warn('Education parse failed', e); }
    return out;
  }

  function getCertifications() {
    progress('certifications', 'collect');
    const out = [];
    try {
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (!h2 || !/(licenses?\s*&?\s*certifications?|certifications?)/i.test(h2.textContent || '')) continue;
        const items = qa('li, .pvs-list__paged-list-item, .artdeco-list__item', sec);
        for (const li of items) {
          const name = norm(text(q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)));
          const issuer = norm(text(q('.t-14.t-normal, .pv-entity__secondary-title, .t-14.t-normal.t-black', li)));
          // Prefer a visible date or time element
          let date = norm(text(q('.t-14.t-normal.t-black--light, time', li)));
          if (!date) {
            const alt = q('.pvs-entity__caption-wrapper', li);
            if (alt) date = norm(text(alt));
          }
          if (name || issuer || date) out.push({ name, issuer, date });
        }
        break;
      }
    } catch (e) { console.warn('Certifications parse failed', e); }
    return out;
  }

  async function scrapeBasics() {
    // Ensure top of page has rendered
    await waitForSelector('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .artdeco-entity-lockup__title span[dir]', 20000);
    await autoScroll();

    // Name
    let name = '';
    const nameNode = q('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .artdeco-entity-lockup__title span[dir]');
    name = norm(text(nameNode));

    // Headline
    let headline = '';
    const hlNode = q('.text-body-medium.break-words, .pv-text-details__left-panel div.text-body-medium, [data-test-id="hero-summary-card-subtitle"]');
    headline = norm(text(hlNode));

    // About
    let about = norm(getAboutSection());

    // Profile picture (safe selectors with fallbacks)
    let profilePic = '';
    try {
      const imgCandidates = [
        'img.pv-top-card-profile-picture__image',
        'img[alt*="profile" i]',
        'img[alt*="photo" i]',
        'img.pv-top-card__photo',
        'img.presence-entity__image',
        'img[src*="/dms/image"]',
      ];
      for (const sel of imgCandidates) {
        const node = q(sel);
        const src = node ? (node.currentSrc || node.src || node.getAttribute('data-delayed-url') || '') : '';
        if (src && /^https?:\/\//i.test(src)) { profilePic = src; break; }
      }
    } catch {}

    // Fallbacks via meta if missing
    if (!name || !headline) {
      const meta = metaFallbackNameHeadline();
      if (!name && meta.name) name = norm(meta.name);
      if (!headline && meta.headline) headline = norm(meta.headline);
    }

    return { name, headline, about, profilePic };
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
        const scopes = qa('.pv-contact-info, .pv-contact-info__modal, .pv-contact-info__container, .pv-contact-info__ci-container, .pv-contact-info__contact-type, .pv-contact-info__contact-item', root);
        const scanRoots = scopes.length ? scopes : [root];
        scanRoots.forEach((scope) => {
          // Links
          qa('a[href^="mailto:"], a[href^="tel:"], a[href^="http"], .pv-contact-info__contact-link', scope).forEach((a) => {
            const href = a.getAttribute('href') || '';
            const t = (a.innerText || a.textContent || '').trim();
            if (/^mailto:/i.test(href)) pushEmail(href.replace(/^mailto:/i, ''));
            else if (/^tel:/i.test(href)) pushPhone(href.replace(/^tel:/i, ''));
            else if (/^https?:/i.test(href)) pushSite(href);
            else if (/@/.test(t)) pushEmail(t);
          });
          // Textual blocks within contact containers only
          qa('.pv-contact-info__contact-type, .pv-contact-info__ci-container, .pv-contact-info__container, .pv-contact-info__contact-item', scope).forEach((el) => {
            const t = (el.innerText || el.textContent || '').trim();
            if (!t) return;
            (t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).forEach((m) => pushEmail(m));
            (t.match(/\bhttps?:\/\/\S+/gi) || []).forEach((m) => pushSite(m));
            (t.match(/\+?[0-9()\[\]\s\-]{6,}/g) || []).forEach((m) => pushPhone(m));
          });
        });
      };

      // 1) Try in-page modal first
      const btn = q('a#top-card-text-details-contact-info, a[data-control-name="contact_see_more"], a[href*="overlay/contact-info"], a[aria-label*="Contact info" i]');
      if (btn) {
        await clickIfExists(btn);
        await waitForSelector('.artdeco-modal[role="dialog"], .pv-contact-info__modal, .pv-contact-info');
        const modal = q('.artdeco-modal[role="dialog"], .pv-contact-info__modal, .pv-contact-info');
        if (modal) {
          const content = q('.artdeco-modal__content, .pv-contact-info__modal-content, .pv-contact-info, .pv-contact-info__container', modal) || modal;
          const scopes = qa('.pv-contact-info, .pv-contact-info__modal, .pv-contact-info__container, .pv-contact-info__ci-container', content);
          (scopes.length ? scopes : [content]).forEach((root) => harvestFromRoot(root));
          const close = q('button[aria-label*="Dismiss" i], button[aria-label*="Close" i], button.artdeco-modal__dismiss', modal);
          try { close && close.click(); } catch (e) { console.warn('contact modal close failed', e); }
        }
      }

      // 2) If still empty, open overlay route in current SPA and parse DOM
      if (ALLOW_SPA_NAV && !data.emails.length && !data.phones.length && !data.websites.length) {
        const m = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
        const base = m ? m[0] : '';
        const overlayUrl = base ? base + 'overlay/contact-info/' : '';
        if (overlayUrl) {
          try {
            const orig = location.href;
            history.pushState({}, '', overlayUrl);
            await waitForSelector('main, #artdeco-modal-outlet, .pv-contact-info');
            const root = q('#artdeco-modal-outlet .artdeco-modal, .pv-contact-info') || document;
            const scopes = qa('.pv-contact-info, .pv-contact-info__container, .pv-contact-info__ci-container', root);
            (scopes.length ? scopes : []).forEach((r) => harvestFromRoot(r));
            try { history.pushState({}, '', orig); } catch {}
          } catch (e) { console.warn('Contact SPA overlay parse failed', e); try { history.back(); } catch {} }
        }
      }

      // 3) As a fallback, fetch the overlay HTML directly and parse
      if (!data.emails.length && !data.phones.length && !data.websites.length) {
        try {
          const m = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
          const base = m ? m[0] : '';
          const url = base ? base + 'overlay/contact-info/' : '';
          if (url) {
            const res = await fetchWithTimeout(url, { credentials: 'include', timeout: 15000 });
            if (res.ok) {
              const html = await res.text();
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const root = doc.querySelector('.pv-contact-info, .pv-contact-info__container, main') || doc;
              const scopes = Array.from(root.querySelectorAll('.pv-contact-info, .pv-contact-info__container, .pv-contact-info__ci-container'));
              scopes.forEach((r) => harvestFromRoot(r));
            }
          }
        } catch (e) { console.warn('Contact overlay fetch failed', e); }
      }

      // Dedup and normalize
      const uniq = (arr) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
      // sanitize emails
      const emailRe = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
      data.emails = uniq(data.emails).filter((e) => emailRe.test(e));
      // sanitize phones (7-15 digits, avoid obvious year ranges)
      const onlyDigits = (s) => (s.match(/\d/g) || []).join('');
      data.phones = uniq(data.phones)
        .map((p) => p.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-'))
        .filter((p) => {
          const d = onlyDigits(p);
          if (d.length < 7 || d.length > 15) return false;
          // reject patterns like "2018 - 2021"
          if (/\b\d{4}\s*-\s*\d{2,4}\b/.test(p)) return false;
          return true;
        });
      // sanitize websites: only http(s). For linkedin.com, only keep this profile's own /in/<slug> URL.
      let profileSlug = '';
      try {
        const m = (location.href || '').match(/https:\/\/www\.linkedin\.com\/in\/[^/]+\//);
        if (m) profileSlug = (m[1] || '').toLowerCase();
      } catch {}
      data.websites = uniq(data.websites).filter((u) => /^https?:\/\//i.test(u)).filter((u) => {
        try {
          const { hostname, pathname } = new URL(u);
          const host = hostname.replace(/^www\./, '').toLowerCase();
          if (host !== 'linkedin.com' && host !== 'www.linkedin.com') return true; // keep external domains
          // For linkedin.com, keep ONLY the current profile base URL
          const m = pathname.match(/^\/in\/([^\/]+)\/?$/);
          if (m && profileSlug && m[1].toLowerCase() === profileSlug) return true;
          return false; // drop all other linkedin routes (company, groups, others' profiles, newsletters, etc.)
        } catch { return false; }
      });
      return data;
    } catch (e) {
      console.warn('Contact info scrape failed:', e);
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
      // Filter obvious garbage and very short strings
      if (s.length < 2) return '';
      return s;
    }

    const harvestList = (root) => {
      qa('li, .pvs-list__paged-list-item, .artdeco-list__item', root).forEach((li) => {
        const name = cleanSkillName(text(q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)));
        if (name) skills.add(name);
      });
      // Also parse inline bullet previews
      qa('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]', root)
        .forEach((el) => splitSkillsInline(el.textContent).forEach((s) => { const n = cleanSkillName(s); if (n) skills.add(n); }));
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
            try { close && close.click(); } catch (e) { console.warn('skills modal close failed', e); }
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
            try { close && close.click(); } catch (e) { console.warn('top skills modal close failed', e); }
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
    return Array.from(skills);
  }

  async function scrapeTopSkills(includeSkills) {
    if (!includeSkills) return [];
    const top = new Set();

    const harvestList = (root) => {
      qa('li, .pvs-list__paged-list-item, .artdeco-list__item', root).forEach((li) => {
        const raw = (q('span[aria-hidden="true"], .mr1.t-bold span, .t-bold', li)?.textContent || '').replace(/\s+/g, ' ').trim();
        const name = (function cleanSkill(name){
          let s = (name || '').replace(/\s+/g, ' ').trim();
          if (!s || s.length < 2) return '';
          if (/\b\d+\s+experiences?\b/i.test(s)) return '';
          if ((/\b(at|across)\b/i.test(s) && s.length > 30)) return '';
          const digits = (s.match(/\d/g) || []).length;
          const letters = (s.match(/[A-Za-z]/g) || []).length;
          if (!letters || digits > letters) return '';
          return s;
        })(raw);
        if (name) top.add(name);
      });
      // Also parse inline bullet list preview near Top skills
      qa('.t-14.t-normal .display-flex.align-items-center span[aria-hidden="true"], .display-flex.full-width .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]', root)
        .forEach((el) => splitSkillsInline(el.textContent).forEach((s) => {
          const cleaned = (function cleanSkill(name){
            let v = (name || '').replace(/\s+/g, ' ').trim();
            if (!v || v.length < 2) return '';
            if (/\b\d+\s+experiences?\b/i.test(v)) return '';
            if ((/\b(at|across)\b/i.test(v) && v.length > 30)) return '';
            const digits = (v.match(/\d/g) || []).length;
            const letters = (v.match(/[A-Za-z]/g) || []).length;
            if (!letters || digits > letters) return '';
            return v;
          })(s);
          if (cleaned && !top.has(cleaned)) { top.add(cleaned); }
        }));
    };

    try {
      // 1) Fetch details/skills first and take first 10 as Top Skills if no explicit group
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
      } catch (e) { console.warn('Top skills fetch-first failed', e); }

      // 2) In-page hints and explicit Top skills group
      let skillsSection = null;
      const sections = qa('section');
      for (const sec of sections) {
        const h2 = q('h2, h3', sec);
        if (h2 && /skills/i.test(h2.textContent)) { skillsSection = sec; break; }
      }
      if (skillsSection) {
        // Look for a Top skills group header
        const topGroup = qa('div, section', skillsSection).find((el) => /top\s+skills/i.test((el.textContent || '')));
        if (topGroup) harvestList(topGroup);
        if (!top.size) harvestList(skillsSection);
        // Try an explicit top-skills overlay button/link
        let openBtn = qa('a, button, [role="button"]', skillsSection).find((b) => {
          const t = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
          const href = b.getAttribute && (b.getAttribute('href') || '');
          return /top\s+skills|show\s+top/i.test(t) || /overlay\/top-skills|details\/skills/i.test(href || '');
        });
        if (openBtn) {
          await clickIfExists(openBtn);
          const modal = await waitForSelector('.artdeco-modal[role="dialog"], .pvs-modal__container, .artdeco-modal', 10000);
          if (modal) {
            const scrollHost = q('.artdeco-modal__content, .pvs-modal__content, [role="dialog"]', modal) || modal;
            await scrollUntilLoaded(scrollHost, 60, 300);
            // If there is a top skills subheader inside modal, prefer it
            const topHdr = qa('h2, h3, .t-bold', modal).find((h) => /top\s+skills/i.test((h.textContent || '')));
            const root = topHdr ? topHdr.closest('section, div') || modal : modal;
            harvestList(root);
            const close = q('button[aria-label*="Dismiss" i], button.artdeco-modal__dismiss, button[aria-label*="Close" i]', modal);
            try { close && close.click(); } catch (e) { console.warn('top skills modal close failed', e); }
          }
        }
      }

      // 3) As last resort, a very quick SPA overlay attempt
      if (ALLOW_SPA_NAV && !top.size) {
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
        } catch (e) { console.warn('Top skills quick SPA failed', e); }
      }
    } catch (e) {
      console.warn('Top skills scrape failed:', e);
    }
    // Only return up to 10 top skills to keep this focused
    return Array.from(top).slice(0, 10);
  }

  async function fetchCommentsForLast7Days(profileUrl) {
    try {
      const base = profileUrl.replace(/\/?$/, '');
      const urls = [base + '/recent-activity/comments/', base + '/recent-activity/all/'];
      const items = [];
      for (const u of urls) {
        try {
          const res = await fetchWithTimeout(u, { credentials: 'include', timeout: 15000 });
          if (!res.ok) continue;
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          qa('article, .feed-shared-update-v2, .ember-view').forEach((card) => {
            const textNode = q('[data-test-commentary], .comments-comment-item__main-content, .update-components-text, .break-words', card);
            const cmt = text(textNode);
            const timeEl = q('time, .update-components-actor__sub-description span, .visually-hidden', card);
            const timeStr = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim() : '';
            const dt = parseRelativeTime(timeStr);
            if (cmt && dt && ((new Date() - dt) / (1000 * 60 * 60 * 24)) <= 7) {
              const link = q('a[href^="https://www.linkedin.com/feed/update/"]', card);
              items.push({ text: cmt, timestamp: dt.toISOString() });
            }
          });
          if (items.length) break; // got some
        } catch (e) { console.warn('Comments fetch loop failed', e); }
      }
      return items;
    } catch (e) {
      console.warn('Comments scrape failed:', e);
      return [];
    }
  }

  async function scrapeAll(options) {
    progress('init');
    await waitForSelector('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .artdeco-entity-lockup__title span[dir]', 20000);
    await autoScroll();

    const profileUrl = getProfileUrl();
    let basics = { name: '', headline: '', about: '', profilePic: '' };
    let experience = [];
    let education = [];
    let licenses = [];
    let contactInfo = null;
    let skills = [];
    let topSkills = [];
    let comments = [];

    progress('basics');
    try { basics = await scrapeBasics(); } catch (e) { console.warn('Basics failed', e); }
    sendPartial('basics', basics);

    if (!basics.name) {
      await sleep(900);
      await autoScroll(8);
      try { basics = await scrapeBasics(); } catch {}
    }

    progress('sections');
    try { experience = getExperience(); } catch (e) { console.warn('Exp failed', e); }
    try { education = getEducation(); } catch (e) { console.warn('Edu failed', e); }
    try { licenses = getCertifications(); } catch (e) { console.warn('Licenses failed', e); }
    sendPartial('sections', { experience, education, licenses });

    progress('contact');
    // Guard heavy steps with per-step timeouts and continue on failure
    const contactP = runWithStepTimeout('contact', () => scrapeContactInfo(!!options.includeContact), 20000, null);
    progress('skills');
    const skillsP = runWithStepTimeout('skills', () => scrapeSkills(!!options.includeSkills), 20000, []);
    progress('top-skills');
    const topSkillsP = runWithStepTimeout('top-skills', () => scrapeTopSkills(!!options.includeSkills), 20000, []);
    const [contactRes, skillsRes, topSkillsRes] = await Promise.all([contactP, skillsP, topSkillsP]);
    contactInfo = contactRes;
    skills = Array.isArray(skillsRes) ? skillsRes : [];
    topSkills = Array.isArray(topSkillsRes) ? topSkillsRes : [];
    sendPartial('contact', contactInfo);
    sendPartial('skills', skills);
    sendPartial('topSkills', topSkills);

    progress('assemble');
    // Dedup topSkills against skills and limit
    const skillsSet = new Set(Array.isArray(skills) ? skills : []);
    const topClean = Array.from(new Set(Array.isArray(topSkills) ? topSkills : [])).filter((s) => !skillsSet.has(s)).slice(0, 10);
    return {
      profileUrl,
      name: basics.name,
      headline: basics.headline,
      about: basics.about,
      profilePic: basics.profilePic || '',
      experience,
      education,
      licenses,
      contactInfo,
      skills,
      topSkills: topClean.length ? topClean : (Array.isArray(skills) ? skills.slice(0, 10) : []),
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
            const dates = norm((card.querySelector('.t-14.t-normal.t-black--light, .pvs-entity__caption-wrapper, .t-12.t-black--light') || {}).textContent || '');
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
      history.pushState({}, '', url);
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

  function getAboutSection() {
    // Prefer explicit about containers (from screenshots and variants)
    const candidate = document.querySelector('section.pv-about-section, .pv-shared-text-with-see-more, [data-test-id="about"], section[id*="about" i], a[name="about"], #about');
    if (candidate) {
      // Try to expand see more buttons locally
      try { expandWithin(candidate); } catch {}
      let txt = (candidate.innerText || candidate.textContent || '').trim();
      if (!txt) {
        // Pull text from common nested spans seen in screenshot
        const nested = Array.from(candidate.querySelectorAll('.white-space-pre, .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]'))
          .map((n) => (n.innerText || n.textContent || '').trim())
          .filter(Boolean)
          .join('\n\n');
        if (nested) txt = nested;
      }
      if (txt) return cleanAboutText(txt);
    }
    // Fallback to previously scraped basics if available later
    const nodes = Array.from(document.querySelectorAll('.pv-about__summary-text, .lt-line-clamp__raw-line, .lt-line-clamp__line, section[id*="about" i] p, .white-space-pre, .t-14.t-normal.t-black.display-flex.align-items-center span[aria-hidden="true"]'));
    const parts = nodes.map((n) => (n.innerText || n.textContent || '').trim()).filter(Boolean);
    return cleanAboutText(parts.join(' ').trim());
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

  function getRecentComments() {
    const now = new Date();
    const comments = [];
    document.querySelectorAll('.comments-comment-item__main-content').forEach((el) => {
      const text = (el.innerText || el.textContent || '').trim();
      const item = el.closest('.comments-comment-item, .comments-comment-item__content');
      const timeEl = item ? item.querySelector('time') : null;
      const iso = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim() : '';
      const dt = parseRelativeTime(iso);
      if (text && dt && ((now - dt) / (1000 * 60 * 60 * 24)) <= 7) {
        comments.push({ text, timestamp: dt.toISOString() });
      }
    });
    return comments;
  }

  // Optional: observe dynamic additions while scrolling current view
  let commentsObserver = null;
  function ensureCommentsObserver() {
    if (commentsObserver) return;
    commentsObserver = new MutationObserver(() => {
      // No heavy work here; consumer can call getRecentComments()
    });
    try { commentsObserver.observe(document.body, { childList: true, subtree: true }); } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PING') { sendResponse({ type: 'PONG' }); return; }
    if (msg && msg.type === 'DO_SCRAPE') {
      (async () => {
        try {
          const data = await withOverallTimeout(scrapeAll(msg.options || {}), 120000);
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
        // comments removed; no observer needed
      } catch {}
      try {
        sendResponse({
          ok: true,
          data: {
            skills: getTopSkills(),
            about: getAboutSection(),
          },
        });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
      return true;
    }
  });
})();

// Allow controlled SPA navigation for deep sections (skills/contact/licenses)
const ALLOW_SPA_NAV = true;
