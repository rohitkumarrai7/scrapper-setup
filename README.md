# OptyMatch LinkedIn Scraper (MV3)

A Chrome Extension that scrapes full LinkedIn profile data and caches the latest structured JSON for seamless future UI and API integration. No external backend is required.

## Features

- Name, Headline, About, Profile Picture URL
- Experience (company, title, date range)
- Education (school, degree, date range)
- Licenses & Certifications (name, issuer, date)
- Contact Info (emails, phones, websites when available)
- Skills and Top Skills
- Caches the latest result using `chrome.storage.session` with fallback to `chrome.storage.local`
- Minimal popup UI to trigger scraping and validate cached data
- Debug helper available via DevTools: `getLastScrape()`

## Project Structure

- `manifest.json` — MV3 manifest
- `background.js` — message router and cache helpers (`saveLastScrape`, `getLastScrape`)
- `content.js` — the DOM scraper (runs on `linkedin.com`)
- `popup.html` — minimal UI
- `popup.js` — popup controller (triggers scrape, saves/loads cache, logs data)

## Setup

1. Open Chrome → Menu → More Tools → Extensions
2. Enable Developer mode (top-right toggle)
3. Click "Load unpacked" and select this project folder

## Usage

1. Log into LinkedIn and open a profile page (URL like `https://www.linkedin.com/in/...`).
2. Click the extension icon to open the popup.
3. Choose options:
   - Include Skills
   - Include Contact Info
4. Click "Scrape Profile". The status will display progress.
5. When complete, the result is auto-saved to the in-memory cache.
6. Click "View Last" to fetch from cache. You can also run `getLastScrape()` in the popup DevTools console.

## Notes on Scraping Stability

- Steps are guarded with per-step timeouts and progress updates.
- Selectors focus on resilient patterns and safe fallbacks.
- Heavy sections (Skills, Contact) run with per-step timeouts and return partial data if a step fails.

## Permissions

- `activeTab`, `tabs` — to read the active tab URL and message the page
- `scripting` — MV3 requirement for script interactions
- `storage` — to cache the last scraped data
- `host_permissions` — `https://www.linkedin.com/*` so the content script can run and fetch deep pages

## Safe-to-Delete (Not used by MV3 extension)

These files/folders are unrelated to the MV3 extension and can be safely removed from the unpacked directory without affecting functionality:

- `server.js` — backend server (not used)
- `scraper.js` — legacy script (not used)
- `models/` — server-side models (not used)
- `database.sqlite` — local DB (not used)
- `libs/jspdf.umd.min.js` — PDF library (not used)
- `pdfGenerator.js` — PDF generation (not used)
- `node_modules/` and `package-lock.json` — not required; the extension does not bundle Node deps

Keeping only:

- `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `icon.png`, `README.md`, `package.json`

## Changelog (Refactor)

- Removed jsPDF and all PDF download features
- Removed Comments feature entirely to improve stability
- Added session cache helpers and DevTools `getLastScrape()`
- Sequentialized heavy scraping steps with per-step timeouts
- Added profile image URL to scraped basics

## License

MIT
