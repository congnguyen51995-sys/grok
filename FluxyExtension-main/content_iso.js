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

// WuwhI/jwpduf complete response — để debug URL format thực tế của Angular app
window.addEventListener('AutoFlow_JWPDUF_RESP', (e) => {
    chrome.runtime.sendMessage({ type: "JWPDUF_COMPLETE_BODY", data: e.detail });
});

// Blob URL created for video (Angular app dùng MSE/blob thay vì direct URL)
window.addEventListener('AutoFlow_VIDEO_BLOB', (e) => {
    chrome.runtime.sendMessage({ type: "VIDEO_BLOB_CREATED", data: e.detail });
});

// Video src assigned (direct URL, not blob)
window.addEventListener('AutoFlow_VIDEO_SRC', (e) => {
    chrome.runtime.sendMessage({ type: "VIDEO_SRC_SET", data: e.detail });
});

// Fetch request to flow-content.google — capture exact URL + auth headers
window.addEventListener('AutoFlow_FC_REQUEST', (e) => {
    chrome.runtime.sendMessage({ type: "FC_REQUEST_CAPTURED", data: e.detail });
});
