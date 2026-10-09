// Storage reader bridge — cho phép page JS đọc chrome.storage.local
window.addEventListener('_fluxyRequest', async (e) => {
    if (e.detail?.type === 'getStorage') {
        const data = await chrome.storage.local.get(null);
        window.dispatchEvent(new CustomEvent('_fluxyResponse', { detail: data }));
    }
});

// Bearer token từ MAIN world (labs.google fallback)
window.addEventListener('AutoFlow_BEARER', (e) => {
    const token = e.detail;
    if (token && token.length > 50) {
        chrome.runtime.sendMessage({ type: "BEARER_FOUND", data: token });
    }
});

// AT + BL + FSID token từ MAIN world (flow.google.com — cookie-based auth)
window.addEventListener('AutoFlow_FLOW_AUTH', (e) => {
    const { at, bl, fsid } = e.detail || {};
    if (at && at.length > 10) {
        chrome.runtime.sendMessage({ type: "FLOW_AUTH_FOUND", data: { at, bl, fsid } });
    }
});

// grecaptcha action+sitekey Angular dùng cho image gen
window.addEventListener('AutoFlow_RC_EXEC', (e) => {
    chrome.runtime.sendMessage({ type: "RC_EXEC_CAPTURED", data: e.detail });
});

// Angular batchexecute RPC calls — log first occurrence mỗi RPC
const _seenBatchRpcs = new Set();
window.addEventListener('AutoFlow_RPC_RESP', (e) => {
    const rpc = e.detail?.rpc;
    if (!rpc || rpc === '?' || rpc === 'nzlxg') return;
    if (!_seenBatchRpcs.has(rpc)) {
        _seenBatchRpcs.add(rpc);
        chrome.runtime.sendMessage({ type: "RPC_RESP_DEBUG", data: { rpc, len: e.detail?.len, snip: (e.detail?.snip || '').substring(0, 500) } });
    }
});
