/**
 * Electron entry point (v2.2).
 * Registers AES decryption hook BEFORE loading any encrypted module.
 * This file is obfuscated-only (not encrypted) so Electron can execute it directly.
 */
require('./crypto-loader');
require('./main');
