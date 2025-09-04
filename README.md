# OptyMatch LinkedIn/Naukri Scraper (MV3)

A Chrome Extension that scrapes full LinkedIn profile data and caches the latest structured JSON for seamless future UI and API integration. No external backend is required.

## Features

- Scrape from any LinkedIn profile page:
  - Name, Headline, About, Profile Pic URL
  - Experience (all visible jobs)
  - Education
  - Licenses & Certifications
  - Contact Info (opens modal and extracts if available)
  - Skills and Top Skills (opens and scrolls skill modal when needed)
  - Recent Comments (last 7 days)
- Caches the latest result using `chrome.storage.session` with fallback to `chrome.storage.local`
- Minimal popup UI to trigger scraping and validate cached data
- Debug helper available via DevTools: `getLastScrape()`

## Project Structure

- `manifest.json` — MV3 manifest
- `background.js` — message router and cache helpers (`saveLastScrape`, `getLastScrape`)
- `content.js` — the DOM scraper (runs on `linkedin.com`)
- `popup.html` — minimal UI aligned with OptyMatch design direction
- `popup.js` — popup controller (triggers scrape, saves/loads cache, logs data)
- `libs/` — no longer required for jsPDF
- Removed: `pdfGenerator.js` usage (PDF generation deprecated)

Unrelated to extension packaging (safe to keep locally but excluded from CRX):
- `server.js`, `scraper.js`, `models/`, `database.sqlite`, `node_modules/`

## Setup

1. Load the extension in Chrome:
   - Open Chrome → Menu → More Tools → Extensions
   - Enable Developer mode (top-right toggle)
   - Click "Load unpacked" and select this project folder

## Usage (Cache-first flow)

1. Log into LinkedIn and open a profile page (URL like `https://www.linkedin.com/in/...`).
2. Click the extension icon to open the popup.
3. Choose options:
   - Include Comments
   - Include Skills
   - Include Contact Info
4. Click "Scrape Profile". The status will display progress.
5. When complete, the result is auto-saved to the in-memory cache.
6. Click "View Last" to fetch from cache and log the JSON to the console.
   - You can also run `getLastScrape()` in the popup DevTools console to print the cached data.

## Notes on Scraping Stability

- Steps are guarded with per-step timeouts and progress updates.
- Selectors focus on resilient patterns and safe fallbacks.
- Heavy sections (Skills, Contact, Comments) have fetch/SPA/modal fallbacks with timeouts.

## Permissions

- `activeTab`, `tabs` — to read the active tab URL and message the page
- `scripting` — MV3 requirement for script interactions
- `storage` — to cache the last scraped data
- `host_permissions` — `https://www.linkedin.com/*` so the content script can run and fetch deep pages

## Troubleshooting

- Not on a LinkedIn profile:
  - You’ll see an error if you try to scrape from a non-profile page.
- Empty sections:
  - Some profiles hide sections or require scrolling/connection privileges; results may vary.
- Comments older than 7 days:
  - We filter by parsed timestamps. If timestamps are ambiguous, some items might be omitted.

## Changelog (Refactor)

- Removed jsPDF and all PDF download features
- Added session cache helpers and DevTools `getLastScrape()`
- Simplified popup UI to a cache-first workflow
- Added profile image URL to scraped basics

## License

MIT
