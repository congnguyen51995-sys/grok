// Storage reader bridge — cho phép page JS đọc chrome.storage.local
window.addEventListener('_fluxyRequest', async (e) => {
    if (e.detail?.type === 'getStorage') {
        const data = await chrome.storage.local.get(null);
        window.dispatchEvent(new CustomEvent('_fluxyResponse', { detail: data }));
    }
});

// CAUS token từ MAIN world
window.addEventListener('AutoFlow_CAUS', (e) => {
    const causList = e.detail;
    if (causList && causList.length > 0) {
        chrome.runtime.sendMessage({ type: "CAUS_FOUND", data: causList });
    }
});

// Bearer token từ MAIN world (labs.google fallback)
window.addEventListener('AutoFlow_BEARER', (e) => {
    const token = e.detail;
    if (token && token.length > 50) {
        chrome.runtime.sendMessage({ type: "BEARER_FOUND", data: token });
    }
});

// AT + BL token từ MAIN world (flow.google.com — cookie-based auth)
window.addEventListener('AutoFlow_FLOW_AUTH', (e) => {
    const { at, bl } = e.detail || {};
    if (at && at.length > 10) {
        chrome.runtime.sendMessage({ type: "FLOW_AUTH_FOUND", data: { at, bl } });
    }
});
