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
        };
        const onUpdatedGuard = (tabId, info, updatedTab) => {
          if (tabId !== tab.id || !info.url) return;
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

        const startPortFlow = () => {
          let settled = false;
          let reinjected = false;
          let port;
          const watchdog = setTimeout(() => {
            if (!settled) {
              settled = true;
              try { port && port.disconnect(); } catch {}
              try { chrome.tabs.onUpdated.removeListener(onUpdatedGuard); } catch {}
              if (!responded) {
                responded = true;
                sendResponse({ ok: false, error: 'Timed out waiting for scrape to finish.' });
              }
            }
          }, 180000);

          const cleanup = () => {
            try { clearTimeout(watchdog); } catch {}
            try { chrome.tabs.onUpdated.removeListener(onUpdatedGuard); } catch {}
          };

          const attachHandlers = (p) => {
            p.onMessage.addListener(async (msg) => {
              try { console.log('[RCRM-BG] port msg:', msg && msg.type); } catch {}
              if (!msg || typeof msg !== 'object') return;
              if (msg.type === 'PROGRESS') {
                if (msg.partialKey && msg.partialData) {
                  try { await chrome.storage.session.set({ [msg.partialKey]: msg.partialData }); }
                  catch { try { await chrome.storage.local.set({ [msg.partialKey]: msg.partialData }); } catch {} }
                }
                return;
              }
              if (msg.type === 'RESULT') {
                if (settled) return;
                settled = true;
                cleanup();
                try {
                  await chrome.storage.session.set({ lastScrape: msg.data });
                } catch {
                  try { await chrome.storage.local.set({ lastScrape: msg.data }); } catch {}
                }
                if (!responded) {
                  responded = true;
                  sendResponse({ ok: true, data: msg.data });
                }
                try { p.disconnect(); } catch {}
              }
              if (msg.type === 'ERROR') {
                if (settled) return;
                settled = true;
                cleanup();
                if (!responded) {
                  responded = true;
                  sendResponse({ ok: false, error: msg.error || 'Scrape failed.' });
                }
                try { p.disconnect(); } catch {}
              }
            });

            p.onDisconnect.addListener(async () => {
              try { console.warn('[RCRM-BG] port disconnected:', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch {}
              if (settled) return;
              const lastErr = chrome.runtime.lastError && chrome.runtime.lastError.message;
              if (!reinjected) {
                reinjected = true;
                try {
                  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
                } catch (e) {
                  settled = true;
                  cleanup();
                  if (!responded) {
                    responded = true;
                    sendResponse({ ok: false, error: 'Failed to inject content script: ' + (e && e.message ? e.message : String(e)) });
                  }
                  return;
                }
                setTimeout(() => {
                  try {
                    const p2 = chrome.tabs.connect(tab.id, { name: 'scrape-port' });
                    attachHandlers(p2);
                    try { p2.postMessage({ type: 'START_SCRAPE', options: request.options || {} }); } catch {}
                  } catch (e) {
                    settled = true;
                    cleanup();
                    if (!responded) {
                      responded = true;
                      sendResponse({ ok: false, error: 'Reconnect failed: ' + (e && e.message ? e.message : String(e)) });
                    }
                  }
                }, 600);
                return;
              }
              settled = true;
              cleanup();
              if (!responded) {
                responded = true;
                sendResponse({ ok: false, error: lastErr || 'Port disconnected before result.' });
              }
            });
          };

          // Always inject first to avoid immediate disconnects on tabs without our content
          try {
            chrome.scripting.executeScript(
              { target: { tabId: tab.id }, files: ['content.js'] },
              () => {
                if (chrome.runtime.lastError) {
                  settled = true;
                  cleanup();
                  if (!responded) {
                    responded = true;
                    sendResponse({ ok: false, error: 'Failed to inject content script: ' + chrome.runtime.lastError.message });
                  }
                  return;
                }
                // Connect after injection
                try {
                  port = chrome.tabs.connect(tab.id, { name: 'scrape-port' });
                  attachHandlers(port);
                  port.postMessage({ type: 'START_SCRAPE', options: request.options || {} });
                } catch (e) {
                  settled = true;
                  cleanup();
                  if (!responded) {
                    responded = true;
                    sendResponse({ ok: false, error: 'Failed to start port-based scrape: ' + (e && e.message ? e.message : String(e)) });
                  }
                }
              }
            );
          } catch (e) {
            settled = true;
            cleanup();
            if (!responded) {
              responded = true;
              sendResponse({ ok: false, error: 'Failed to inject: ' + (e && e.message ? e.message : String(e)) });
            }
          }
        };

        // Kick off the port-based flow
        startPortFlow();
      };

      if (url !== baseUrl) {
        let done = false;
        const onUpdated = (tabId, info, updatedTab) => {
          if (done) return;
          if (tabId === tab.id && info.status === 'complete' && updatedTab && updatedTab.url && updatedTab.url.startsWith(baseUrl)) {
            done = true;
            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
            try { clearTimeout(navWatchdog); } catch {}
            try {
              proceed();
            } catch (e) {
              if (!responded) {
                responded = true;
                sendResponse({ ok: false, error: 'Failed to start scrape: ' + (e && e.message ? e.message : String(e)) });
              }
            }
          }
        };
        const navWatchdog = setTimeout(() => {
          if (!done && !responded) {
            done = true;
            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
            try {
              responded = true;
              sendResponse({ ok: false, error: 'Navigation to base profile timed out.' });
            } catch {}
          }
        }, 30000);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.update(tab.id, { url: baseUrl });
        return true; 
      }

      try {
        proceed();
      } catch (e) {
        if (!responded) {
          responded = true;
          sendResponse({ ok: false, error: 'Failed to start scrape: ' + (e && e.message ? e.message : String(e)) });
        }
      }
    });
    return true; 
  }

  if (request.type === 'GET_LAST_SCRAPE' || request.type === 'GET_LAST_DATA') {
    try {
      chrome.storage.session.get('lastScrape', (res) => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.get('lastScrape', (res2) => {
            sendResponse({ ok: true, data: res2 && res2.lastScrape ? res2.lastScrape : null });
          });
          return;
        }
        const data = (res && res.lastScrape) || null;
        if (data) { sendResponse({ ok: true, data }); return; }
        chrome.storage.local.get('lastScrape', (res2) => {
          sendResponse({ ok: true, data: res2 && res2.lastScrape ? res2.lastScrape : null });
        });
      });
    } catch (e) {
      chrome.storage.local.get('lastScrape', (res2) => {
        sendResponse({ ok: true, data: res2 && res2.lastScrape ? res2.lastScrape : null });
      });
    }
    return true;
  }

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

  if (request.type === 'AUTH_LOGIN') {
    sendResponse({ ok: false, error: 'Not implemented' });
    return true;
  }

  if (request.type === 'PUSH_TO_ATS') {
    sendResponse({ ok: false, error: 'Not implemented' });
    return true;
  }
});

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

globalThis.saveLastScrape = saveLastScrape;
globalThis.getLastScrape = getLastScrape;
