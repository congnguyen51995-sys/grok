'use strict';
/**
 * RVC Engine — Node.js wrapper cho rvc_infer.py
 * Tìm Python, check/install deps, chạy voice conversion.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const SCRIPT = path.join(__dirname, '..', 'rvc_infer.py');

// ── Tìm Python executable trên hệ thống ──────────────────────────────────────
function findPython() {
    for (const cmd of ['python', 'python3', 'py']) {
        try {
            const out = execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 4000 }).toString();
            if (/Python 3\.\d+/.test(out)) return cmd;
        } catch (_) {}
    }
    return null;
}

// ── Chạy rvc_infer.py với args JSON ──────────────────────────────────────────
function runScript(pythonCmd, args, sendLog) {
    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCmd, [SCRIPT, JSON.stringify(args)], {
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        let lastLine = '';

        proc.stdout.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    if (obj.progress && sendLog) sendLog(`🎤 RVC: ${obj.progress}`, 'info');
                    lastLine = line;
                } catch (_) {}
            }
        });

        proc.stderr.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text && sendLog) {
                // Lọc bỏ deprecation warnings không quan trọng
                if (!text.includes('DeprecationWarning') && !text.includes('FutureWarning')) {
                    sendLog(`[RVC] ${text.slice(0, 200)}`, 'info');
                }
            }
        });

        proc.on('close', (code) => {
            try {
                const obj = JSON.parse(lastLine);
                if (obj.ok) resolve(obj);
                else reject(new Error(obj.error || 'RVC thất bại'));
            } catch (_) {
                if (code === 0) resolve({ ok: true });
                else reject(new Error(`RVC exit code ${code}`));
            }
        });

        proc.on('error', reject);
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Kiểm tra Python và rvc-python đã cài chưa. */
async function checkDeps(pythonCmd, sendLog) {
    return runScript(pythonCmd, { cmd: 'check' }, sendLog);
}

/** Cài torch + rvc-python qua pip. */
async function installDeps(pythonCmd, sendLog) {
    return runScript(pythonCmd, { cmd: 'install' }, sendLog);
}

/**
 * Chạy voice conversion.
 * @param {string} pythonCmd
 * @param {{ input, output, model, index, pitch, f0Method }} opts
 * @param {Function} sendLog
 */
async function runInfer(pythonCmd, { input, output, pitch = 0, f0Method = 'medium' }, sendLog) {
    return runScript(pythonCmd, {
        cmd: 'infer',
        input, output,
        pitch,
        mode: f0Method, // light / medium / strong
    }, sendLog);
}

module.exports = { findPython, checkDeps, installDeps, runInfer };
