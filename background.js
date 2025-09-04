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

      const proceed = () => {
        let responded = false;
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

        const handleResult = (resp) => {
          if (responded || navAbort) return;
          if (!resp || !resp.ok) {
            responded = true;
            clearGuards();
            sendResponse({ ok: false, error: resp && resp.error ? resp.error : 'Scrape failed.' });
            return;
          }
          chrome.storage.local.set({ lastProfileData: resp.data }, () => {
            if (!responded) {
              responded = true;
              clearGuards();
              sendResponse({ ok: true, data: resp.data });
            }
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
        sendScrape();
      };

      // If not already on base profile URL, navigate first and wait
      if (url !== baseUrl) {
        let done = false;
        const onUpdated = (tabId, info, updatedTab) => {
          if (done) return;
          if (tabId === tab.id && info.status === 'complete' && updatedTab && updatedTab.url && updatedTab.url.startsWith(baseUrl)) {
            done = true;
            chrome.tabs.onUpdated.removeListener(onUpdated);
            proceed();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.update(tab.id, { url: baseUrl });
        return true; // keep channel open
      }

      proceed();
    });
    return true; // keep sendResponse alive
  }

  if (request.type === 'GET_LAST_DATA') {
    chrome.storage.local.get('lastProfileData', (res) => {
      sendResponse({ ok: true, data: res.lastProfileData || null });
    });
    return true;
  }

  // Save partial data progressively so popup can recover last known sections
  if (request.type === 'PARTIAL_DATA') {
    try {
      const { section, data } = request;
      chrome.storage.local.get('lastProfileData', (res) => {
        const prev = res.lastProfileData || {};
        const merged = { ...prev };
        if (section && typeof section === 'string') {
          merged[section] = data;
        } else if (data && typeof data === 'object') {
          Object.assign(merged, data);
        }
        chrome.storage.local.set({ lastProfileData: merged }, () => {
          sendResponse({ ok: true });
        });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
    return true;
  }
});
