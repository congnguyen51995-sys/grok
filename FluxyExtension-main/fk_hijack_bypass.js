/**
 * fk_hijack_bypass.js — Three-level property trap for grecaptcha.enterprise.execute
 *
 * Runs in MAIN world at document_start (via manifest.json) — guaranteed to
 * execute before any page scripts, including the reCAPTCHA loader and Flow's
 * x2a trap.
 *
 * Flow's front-end ships a function x2a that overwrites grecaptcha.enterprise.execute
 * with a wrapper which forces action: "extension_hijack_detected" via Object.assign.
 * This script intercepts the pristine execute function before x2a can overwrite it,
 * and exposes it via window.__fluxy_hijack for fk_injected.js to consume.
 *
 * Three capture layers, each a fallback for the one above:
 *   Level 1: defineProperty on window.grecaptcha
 *   Level 2: defineProperty on grecaptcha.enterprise
 *   Level 3: defineProperty on enterprise.execute
 *
 * Plus two polling fallbacks:
 *   - Rapid poll (2ms): catches cases where defineProperty gets clobbered
 *   - ready() callback race (5ms): registers our callback before Angular's
 */
(function () {
  'use strict';

  let _pristineExecute = null;
  let _capturedTrapped = false;
  let _captureSource = null;

  function savePristine(fn, enterprise, source) {
    if (_pristineExecute || typeof fn !== 'function') return false;
    try {
      const src = fn.toString();
      if (src.includes('extension_hijack_detected')) {
        _capturedTrapped = true;
        return false;
      }
    } catch (e) {}
    _pristineExecute = fn.bind(enterprise);
    _captureSource = source;
    Promise.resolve().then(cleanAllTraps);
    return true;
  }

  function cleanTrap(obj, prop) {
    try {
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      if (!desc || (!desc.get && !desc.set)) return;
      Object.defineProperty(obj, prop, {
        value: desc.get ? desc.get() : undefined,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  let _cleanedUp = false;
  function cleanAllTraps() {
    if (_cleanedUp) return;
    _cleanedUp = true;
    try {
      const gc = window.grecaptcha;
      if (gc) {
        const ent = gc.enterprise;
        if (ent) cleanTrap(ent, 'execute');
        cleanTrap(gc, 'enterprise');
      }
      cleanTrap(window, 'grecaptcha');
    } catch (e) {}
  }

  function watchExecute(enterprise) {
    let _val = enterprise.execute;
    if (typeof _val === 'function' && savePristine(_val, enterprise, 'L3-immediate')) {
      return;
    }
    try {
      Object.defineProperty(enterprise, 'execute', {
        get() { return _val; },
        set(fn) {
          _val = fn;
          savePristine(fn, enterprise, 'L3-setter');
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  function watchEnterprise(grecaptcha) {
    let _val = grecaptcha.enterprise;
    if (_val && typeof _val === 'object') {
      watchExecute(_val);
    }
    try {
      Object.defineProperty(grecaptcha, 'enterprise', {
        get() { return _val; },
        set(obj) {
          _val = obj;
          if (obj && typeof obj === 'object') {
            watchExecute(obj);
          }
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  function installCapture() {
    let _val = window.grecaptcha;
    if (_val && typeof _val === 'object') {
      watchEnterprise(_val);
    }
    try {
      Object.defineProperty(window, 'grecaptcha', {
        get() { return _val; },
        set(obj) {
          _val = obj;
          if (obj && typeof obj === 'object') {
            watchEnterprise(obj);
          }
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}

    const pollId = setInterval(() => {
      if (_pristineExecute) { clearInterval(pollId); return; }
      try {
        const exec = window.grecaptcha?.enterprise?.execute;
        if (typeof exec === 'function') {
          savePristine(exec, window.grecaptcha.enterprise, 'poll-2ms');
          if (_pristineExecute) clearInterval(pollId);
        }
      } catch (e) {}
    }, 2);
    setTimeout(() => clearInterval(pollId), 30000);

    const readyPollId = setInterval(() => {
      if (_pristineExecute) { clearInterval(readyPollId); return; }
      try {
        const ready = window.grecaptcha?.enterprise?.ready;
        if (typeof ready === 'function') {
          clearInterval(readyPollId);
          ready.call(window.grecaptcha.enterprise, () => {
            try {
              const exec = window.grecaptcha?.enterprise?.execute;
              if (typeof exec === 'function') {
                savePristine(exec, window.grecaptcha.enterprise, 'ready-race');
              }
            } catch (e) {}
          });
        }
      } catch (e) {}
    }, 5);
    setTimeout(() => clearInterval(readyPollId), 30000);
  }

  installCapture();

  try {
    Object.defineProperty(window, '__fluxy_hijack', {
      value: Object.freeze({
        get pristine() { return _pristineExecute; },
        get trapped() { return _capturedTrapped; },
        get source()  { return _captureSource; },
      }),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch (e) {
    window.__fluxy_hijack = {
      get pristine() { return _pristineExecute; },
      get trapped() { return _capturedTrapped; },
      get source()  { return _captureSource; },
    };
  }
})();
