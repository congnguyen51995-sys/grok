window.addEventListener('AutoFlow_CAUS', (e) => {
    const causList = e.detail;
    if (causList && causList.length > 0) {
        chrome.runtime.sendMessage({ type: "CAUS_FOUND", data: causList });
    }
});