# LinkedIn Profile Scraper (MV3)

A Chrome Extension that scrapes full LinkedIn profile data (including skills and recent comments) and exports a formatted PDF. No external API or backend server is used.

## Features

- Scrape from any LinkedIn profile page:
  - Name, Headline, About
  - Experience (all visible jobs)
  - Education
  - Licenses & Certifications
  - Contact Info (opens modal and extracts if available)
  - Top Skills
    - Detects and opens the "Show all skills" modal
    - Scrolls to load all skills inside the modal
    - Closes the modal automatically
  - Recent Comments (last 7 days)
    - Loads the Activity → Comments page HTML
    - Parses comment text, timestamp, and post link
    - Filters to only the last 7 days
- Generate a clean, structured PDF using jsPDF
- Minimal popup UI with options and status messages
- Stores last scraped result in `chrome.storage.local` and allows reloading

## Project Structure

- `manifest.json` — MV3 manifest
- `background.js` — message router and storage
- `content.js` — the DOM scraper (runs on `linkedin.com`)
- `popup.html` — popup UI
- `popup.js` — popup controller (sends messages, handles status, triggers PDF)
- `pdfGenerator.js` — loads jsPDF from local file and builds the PDF
- `libs/jspdf.umd.min.js` — jsPDF UMD build (you add this file locally)

Removed/Unneeded for extension packaging:
- `server.js`, `scraper.js`, `models/`, `database.sqlite`, `node_modules/`

## Setup

1. Download jsPDF UMD build:
   - Get jsPDF v2.x UMD bundle (e.g., from https://github.com/parallax/jsPDF/releases)
   - Create a folder `libs/` in the project root
   - Save the file as `libs/jspdf.umd.min.js`

2. Load the extension in Chrome:
   - Open Chrome → Menu → More Tools → Extensions
   - Enable Developer mode (top-right toggle)
   - Click "Load unpacked" and select this project folder

## Usage

1. Log into LinkedIn and open a profile page (URL like `https://www.linkedin.com/in/...`).
2. Click the extension icon to open the popup.
3. Choose options:
   - Include Comments
   - Include Skills
   - Include Contact Info
4. Click "Scrape Full Profile". The status will update.
5. When complete, click "Download PDF" to save the formatted profile.
6. You can click "View Last Data" to reload and export the previously scraped result.

## Notes on Scraping

- Skills Modal:
  - The content script looks for buttons like "Show all skills".
  - It clicks the button, waits for the modal, scrolls to load all entries, collects them, and closes the modal.
- Comments (Last 7 days):
  - The content script fetches the `…/recent-activity/comments/` page HTML and parses it for comments.
  - It attempts to capture comment text, timestamps (relative or absolute) and the source post link, and keeps only those within the last 7 days.
  - If LinkedIn changes its markup, selectors may need updates.

## Permissions

- `activeTab`, `tabs` — to read the active tab URL and message the page
- `scripting` — MV3 requirement for script interactions
- `storage` — to persist last scraped data
- `host_permissions` — `https://www.linkedin.com/*` so the content script can run and fetch the comments page

## Troubleshooting

- Not on a LinkedIn profile:
  - The popup will show an error if you try to scrape from a non-LinkedIn page.
- Missing jsPDF:
  - Ensure `libs/jspdf.umd.min.js` exists; the popup loads it to generate PDFs. No CDN is used.
- Empty sections:
  - Some profiles hide sections or require scrolling or connection privileges; results may vary.
- Comments older than 7 days:
  - We filter by parsed timestamps. If timestamps are ambiguous, some items might be omitted.

## Packaging Tips

Before zipping and publishing, remove non-extension files/folders:
- `server.js`
- `scraper.js`
- `models/`
- `database.sqlite`
- `node_modules/`

These are not necessary for the extension and may be rejected or increase package size.

## License

MIT
