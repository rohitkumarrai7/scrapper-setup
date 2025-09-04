chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCRAPE_PROFILE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: 'No active tab found.' });
        return;
      }
      const url = tab.url || '';
      const isLinkedIn = /https?:\/\/([a-zA-Z0-9-]+\.)*linkedin\.com\//.test(url);
      const inMatch = url.match(/https?:\/\/([a-zA-Z0-9-]+\.)*linkedin\.com\/in\/([^\/?#]+)\/?/);
      if (!isLinkedIn || !inMatch) {
        sendResponse({ ok: false, error: 'Please open a LinkedIn profile URL like https://www.linkedin.com/in/<username>/' });
        return;
      }
      const baseUrl = `https://www.linkedin.com/in/${inMatch[2]}/`;

      let responded = false;
      const proceed = () => {
        let navAbort = false;
        const clearGuards = () => {
          try { chrome.tabs.onUpdated.removeListener(onUpdatedGuard); } catch {}
          try { clearTimeout(watchdog); } catch {}
        };
        const onUpdatedGuard = (tabId, info, updatedTab) => {
          if (tabId !== tab.id || !info.url) return;
          // If page navigates away from the base profile during scrape, abort and respond with error
          if (!info.url.startsWith(baseUrl)) {
            navAbort = true;
            clearGuards();
            if (!responded) {
              responded = true;
              sendResponse({ ok: false, error: 'Page navigated away during scraping.' });
            }
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdatedGuard);

        const watchdog = setTimeout(() => {
          if (!responded) {
            responded = true;
            chrome.tabs.onUpdated.removeListener(onUpdatedGuard);
            sendResponse({ ok: false, error: 'Timed out waiting for scrape to finish.' });
          }
        }, 120000);

        const handleResult = async (resp) => {
          if (responded || navAbort) return;
          if (!resp || !resp.ok) {
            responded = true;
            clearGuards();
            sendResponse({ ok: false, error: resp && resp.error ? resp.error : 'Scrape failed.' });
            return;
          }
          try {
            await chrome.storage.session.set({ lastScrape: resp.data });
          } catch (e) {
            // Session storage not available? fall back to local
            try { await chrome.storage.local.set({ lastScrape: resp.data }); } catch {}
          }
          if (!responded) {
            responded = true;
            clearGuards();
            sendResponse({ ok: true, data: resp.data });
          }
        };

        const ping = (cb) => {
          chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (pong) => {
            if (chrome.runtime.lastError) { cb(false); return; }
            cb(!!pong && pong.type === 'PONG');
          });
        };

        const sendScrape = () =>
          chrome.tabs.sendMessage(
            tab.id,
            { type: 'DO_SCRAPE', options: request.options || {} },
            (resp) => {
              if (chrome.runtime.lastError) {
                const msg = chrome.runtime.lastError.message || '';
                if (/Receiving end does not exist/i.test(msg)) {
                  // Try to inject and ping before retrying scrape
                  chrome.scripting.executeScript(
                    { target: { tabId: tab.id }, files: ['content.js'] },
                    () => {
                      if (chrome.runtime.lastError) {
                        if (!responded) {
                          responded = true;
                          clearGuards();
                          sendResponse({ ok: false, error: 'Failed to inject content script: ' + chrome.runtime.lastError.message });
                        }
                        return;
                      }
                      ping((alive) => {
                        if (!alive) {
                          if (!responded) {
                            responded = true;
                            clearGuards();
                            sendResponse({ ok: false, error: 'Content script not responding after injection.' });
                          }
                          return;
                        }
                        chrome.tabs.sendMessage(
                          tab.id,
                          { type: 'DO_SCRAPE', options: request.options || {} },
                          (resp2) => {
                            if (chrome.runtime.lastError) {
                              if (!responded) {
                                responded = true;
                                clearGuards();
                                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                              }
                              return;
                            }
                            handleResult(resp2);
                          }
                        );
                      });
                    }
                  );
                  return; // keep channel open
                }
                if (!responded) {
                  responded = true;
                  clearGuards();
                  sendResponse({ ok: false, error: msg });
                }
                return;
              }
              handleResult(resp);
            }
          );

        // Preflight ping: if alive, scrape; else try injection path
        ping((alive) => {
          if (alive) { sendScrape(); return; }
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                if (!responded) {
                  responded = true;
                  clearGuards();
                  sendResponse({ ok: false, error: 'Failed to inject content script: ' + chrome.runtime.lastError.message });
                }
                return;
              }
              // Ping again then scrape
              ping((alive2) => {
                if (!alive2) {
                  if (!responded) {
                    responded = true;
                    clearGuards();
                    sendResponse({ ok: false, error: 'Content script not responding after injection.' });
                  }
                  return;
                }
                sendScrape();
              });
            }
          );
        });
      };

      // If not already on base profile URL, navigate first and wait
      if (url !== baseUrl) {
        let done = false;
        const onUpdated = (tabId, info, updatedTab) => {
          if (done) return;
          if (tabId === tab.id && info.status === 'complete' && updatedTab && updatedTab.url && updatedTab.url.startsWith(baseUrl)) {
            done = true;
            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
            try { clearTimeout(navWatchdog); } catch {}
            proceed();
          }
        };
        // Navigation watchdog to avoid hanging the channel if "complete" never fires
        const navWatchdog = setTimeout(() => {
          if (!done && !responded) {
            done = true;
            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
            try { /* no-op */ } catch {}
            try { sendResponse({ ok: false, error: 'Navigation to base profile timed out.' }); } catch {}
          }
        }, 20000);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.update(tab.id, { url: baseUrl });
        return true; // keep channel open
      }

      proceed();
    });
    return true; // keep sendResponse alive
  }

  if (request.type === 'GET_LAST_SCRAPE' || request.type === 'GET_LAST_DATA') {
    try {
      chrome.storage.session.get('lastScrape', (res) => {
        if (chrome.runtime.lastError) {
          // fallback to local on error
          chrome.storage.local.get('lastScrape', (res2) => {
            sendResponse({ ok: true, data: res2 && res2.lastScrape ? res2.lastScrape : null });
          });
          return;
        }
        const data = (res && res.lastScrape) || null;
        if (data) { sendResponse({ ok: true, data }); return; }
        // fallback to local if session empty
        chrome.storage.local.get('lastScrape', (res2) => {
          sendResponse({ ok: true, data: res2 && res2.lastScrape ? res2.lastScrape : null });
        });
      });
    } catch (e) {
      // last resort: try local and respond
      chrome.storage.local.get('lastScrape', (res2) => {
        sendResponse({ ok: true, data: res2 && res2.lastScrape ? res2.lastScrape : null });
      });
    }
    return true;
  }

  // Save partial data progressively so popup can recover last known sections
  if (request.type === 'PARTIAL_DATA') {
    try {
      const { section, data } = request;
      chrome.storage.session.get('lastScrape', (res) => {
        const prev = (res && res.lastScrape) || {};
        const merged = { ...prev };
        if (section && typeof section === 'string') {
          merged[section] = data;
        } else if (data && typeof data === 'object') {
          Object.assign(merged, data);
        }
        chrome.storage.session.set({ lastScrape: merged }, () => {
          if (chrome.runtime.lastError) {
            // fallback to local
            chrome.storage.local.set({ lastScrape: merged }, () => sendResponse({ ok: true }));
            return;
          }
          sendResponse({ ok: true });
        });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
    return true;
  }

  // Optional explicit save hook (e.g., from popup button)
  if (request.type === 'SAVE_LAST_SCRAPE') {
    try {
      chrome.storage.session.set({ lastScrape: request.data }, () => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.set({ lastScrape: request.data }, () => sendResponse({ ok: true }));
          return;
        }
        sendResponse({ ok: true });
      });
    } catch (e) {
      chrome.storage.local.set({ lastScrape: request.data }, () => sendResponse({ ok: true }));
    }
    return true;
  }

  // TODO: login/auth handshake for future integration
  if (request.type === 'AUTH_LOGIN') {
    // TODO: integrate with OptyMatch auth API here
    sendResponse({ ok: false, error: 'Not implemented' });
    return true;
  }

  // TODO: push to ATS backend in future step
  if (request.type === 'PUSH_TO_ATS') {
    // TODO: send cached profile to backend ATS API here
    sendResponse({ ok: false, error: 'Not implemented' });
    return true;
  }
});

// Expose helpers for future UI modules (MV3 service worker scope)
// Note: Not accessible from page DevTools directly; popup/content can relay.
async function saveLastScrape(data) {
  try { await chrome.storage.session.set({ lastScrape: data }); }
  catch { await chrome.storage.local.set({ lastScrape: data }); }
}
async function getLastScrape() {
  try {
    const res = await chrome.storage.session.get('lastScrape');
    if (res && res.lastScrape) return res.lastScrape;
    const res2 = await chrome.storage.local.get('lastScrape');
    return res2.lastScrape || null;
  } catch {
    const res2 = await chrome.storage.local.get('lastScrape');
    return res2.lastScrape || null;
  }
}

// Attach to global for import by future UI scripts
globalThis.saveLastScrape = saveLastScrape;
globalThis.getLastScrape = getLastScrape;
