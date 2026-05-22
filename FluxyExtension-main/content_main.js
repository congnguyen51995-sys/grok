console.log("AutoFlow V64 Main World Interceptor Loaded!");

const originalFetch = window.fetch;
window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');

    if (url.includes('aisandbox-pa.googleapis.com')) {
        console.log("AutoFlow: Intercepting Fetch to -> ", url);
        const clone = response.clone();
        clone.text().then(text => processCausText(text)).catch(e => { console.error("AutoFlow Clone Error", e); });
    }
    return response;
};

const originalXhrOpen = XMLHttpRequest.prototype.open;
const originalXhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalXhrOpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
        if (this._url && this._url.includes('aisandbox-pa.googleapis.com')) {
            console.log("AutoFlow: Intercepting XHR to -> ", this._url);
            if (this.responseText) {
                processCausText(this.responseText);
            }
        }
    });
    return originalXhrSend.apply(this, args);
};

function processCausText(text) {
    const matches = text.match(/CAUS[A-Za-z0-9_-]{30,}/g);
    if (matches && matches.length > 0) {
        console.log("AutoFlow: CAPTURED DIRECT CAUS!", matches);
        window.dispatchEvent(new CustomEvent('AutoFlow_CAUS', { detail: [...new Set(matches)] }));
    }

    if (text.includes('"projectId"') && (text.includes('"workflowId"') || text.includes('"name"'))) {
        try {
            const mediaMatch = text.match(/"name"\s*:\s*"([0-9a-f-]{36})"/);
            const projectMatch = text.match(/"projectId"\s*:\s*"([0-9a-f-]{36})"/);
            const workflowMatch = text.match(/"workflowId"\s*:\s*"([0-9a-f-]{36})"/);
            const stepMatch = text.match(/"workflowStepId"\s*:\s*"([^"]+)"/);

            if (mediaMatch && projectMatch && workflowMatch) {
                const mediaId = mediaMatch[1];
                const projectId = projectMatch[1];
                const workflowId = workflowMatch[1];
                const stepId = stepMatch ? stepMatch[1] : 'CAE';

                const buf = [];
                buf.push(0x08, 0x05);
                buf.push(0x12, projectId.length);
                for (let i = 0; i < projectId.length; i++) buf.push(projectId.charCodeAt(i));
                buf.push(0x1a, mediaId.length);
                for (let i = 0; i < mediaId.length; i++) buf.push(mediaId.charCodeAt(i));
                buf.push(0x22, stepId.length);
                for (let i = 0; i < stepId.length; i++) buf.push(stepId.charCodeAt(i));
                buf.push(0x2a, workflowId.length);
                for (let i = 0; i < workflowId.length; i++) buf.push(workflowId.charCodeAt(i));

                const b64 = btoa(String.fromCharCode.apply(null, buf)).replace(/=+$/, '');
                console.log("AutoFlow: RECONSTRUCTED CAUS FROM JSON!", b64);
                window.dispatchEvent(new CustomEvent('AutoFlow_CAUS', { detail: [b64] }));
            }
        } catch (e) { console.error("AutoFlow CAUS Build Error", e); }
    }
}

function buildCausString(projectId, mediaId, workflowId, stepId = 'CAE') {
    const buf = [];
    buf.push(0x08, 0x05);
    buf.push(0x12, projectId.length);
    for (let i = 0; i < projectId.length; i++) buf.push(projectId.charCodeAt(i));
    buf.push(0x1a, mediaId.length);
    for (let i = 0; i < mediaId.length; i++) buf.push(mediaId.charCodeAt(i));
    buf.push(0x22, stepId.length);
    for (let i = 0; i < stepId.length; i++) buf.push(stepId.charCodeAt(i));
    buf.push(0x2a, workflowId.length);
    for (let i = 0; i < workflowId.length; i++) buf.push(workflowId.charCodeAt(i));
    return btoa(String.fromCharCode.apply(null, buf)).replace(/=+$/, '');
}

setInterval(() => {
    const loc = window.location.href;
    const projectMatch = loc.match(/project\/([0-9a-f-]{36})/);
    const mediaMatch = loc.match(/edit\/([0-9a-f-]{36})/);

    let workflowId = null;
    let fallbackRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

    if (projectMatch && mediaMatch && document.body) {
        let rootState = document.body.innerHTML;
        let m;
        while ((m = fallbackRegex.exec(rootState)) !== null) {
            let id = m[1];
            if (id !== projectMatch[1] && id !== mediaMatch[1]) {
                workflowId = id;
                break;
            }
        }

        if (workflowId) {
            const b64 = buildCausString(projectMatch[1], mediaMatch[1], workflowId, 'CAE');
            window.dispatchEvent(new CustomEvent('AutoFlow_CAUS', { detail: [b64] }));
        }
    }
}, 3000);