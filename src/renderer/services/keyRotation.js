/**
 * retryWithKeyRotation — Tự động xoay vòng API key khi hết token/quota/rate-limit.
 *
 * Áp dụng cho TẤT CẢ panel trong Creator (hiện tại và tương lai).
 *
 * Luồng xử lý:
 *  429 / RESOURCE_EXHAUSTED / quota / hết token
 *    → Chuyển ngay sang key tiếp theo, KHÔNG chờ
 *    → Nếu đã thử hết tất cả keys 1 vòng → chờ rồi thử lại (tối đa maxCycles vòng)
 *
 *  503 / UNAVAILABLE / overloaded
 *    → Retry chính key đó với backoff, xoay key mỗi 3 lần
 *
 *  Lỗi khác (500, SAFETY, network, v.v.)
 *    → Ném ra ngay, KHÔNG retry
 *
 * @param {(key: string) => Promise<any>} fn     - hàm nhận một API key, trả về Promise
 * @param {string[]}                      apiKeys - mảng API keys
 * @param {object}                        opts
 * @param {function} opts.onSwitch   - gọi khi xoay key: ({ fromIdx, toIdx, total, reason })
 * @param {number}   opts.maxCycles  - số vòng tối đa qua tất cả keys (default: 5)
 */
export async function retryWithKeyRotation(fn, apiKeys, { onSwitch, maxCycles = 5 } = {}) {
  const keys = (apiKeys || []).map(k => (k || '').trim()).filter(Boolean);
  if (!keys.length) {
    throw new Error('Chưa có API Key hợp lệ. Vui lòng nhập Gemini API Key tại mục quản lý keys.');
  }

  let keyIdx      = 0;
  let cycles      = 0;
  let retries503  = 0;
  let lastError;

  // Số key đã được thử liên tiếp mà không thành công trong vòng hiện tại
  let keysTriedThisCycle = 0;

  while (cycles < maxCycles) {
    const key = keys[keyIdx];
    try {
      const result = await fn(key);
      return result; // ✅ Thành công
    } catch (error) {
      lastError = error;

      const { is429, is503, reason } = classifyError(error);

      // ── HẾT TOKEN / QUOTA / RATE LIMIT ──────────────────────────────────────
      if (is429) {
        const nextIdx = (keyIdx + 1) % keys.length;
        onSwitch?.({ fromIdx: keyIdx, toIdx: nextIdx, total: keys.length, reason });
        keyIdx = nextIdx;
        keysTriedThisCycle++;
        retries503 = 0;

        // Đã thử hết tất cả keys trong vòng này
        if (keysTriedThisCycle >= keys.length) {
          cycles++;
          keysTriedThisCycle = 0;

          if (cycles < maxCycles) {
            // Chờ ngắn rồi thử lại từ đầu — cho phép rate-limit per-minute reset
            const waitMs = 15000 + 10000 * (cycles - 1); // 15s, 25s, 35s, 45s
            console.warn(
              `[KeyRotation] Đã thử ${keys.length} keys, tất cả bị giới hạn. ` +
              `Chờ ${waitMs / 1000}s trước vòng ${cycles + 1}/${maxCycles}...`
            );
            await sleep(waitMs);
          }
        }
        continue;
      }

      // ── SERVER QUÁ TẢI (503) ─────────────────────────────────────────────────
      if (is503) {
        retries503++;
        if (retries503 > 12) {
          // Xoay key và reset đếm 503
          const nextIdx = (keyIdx + 1) % keys.length;
          onSwitch?.({ fromIdx: keyIdx, toIdx: nextIdx, total: keys.length, reason: 'server_overloaded' });
          keyIdx = nextIdx;
          retries503 = 0;
          continue;
        }
        const waitMs = Math.min(45000, 3000 * Math.pow(1.5, retries503 - 1));
        console.warn(
          `[KeyRotation] 503 key ${keyIdx + 1}. ` +
          `Retry ${retries503}/12 sau ${Math.round(waitMs / 1000)}s...`
        );
        await sleep(waitMs);
        // Xoay key mỗi 3 lần 503
        if (retries503 % 3 === 0 && keys.length > 1) {
          const nextIdx = (keyIdx + 1) % keys.length;
          onSwitch?.({ fromIdx: keyIdx, toIdx: nextIdx, total: keys.length, reason: 'server_overloaded' });
          keyIdx = nextIdx;
        }
        continue;
      }

      // ── LỖI KHÁC → NÉM RA NGAY ──────────────────────────────────────────────
      throw error;
    }
  }

  // Đã hết tất cả vòng thử → báo lỗi rõ ràng
  const keyCount = keys.length;
  throw new Error(
    `Tất cả ${keyCount} API key đã hết quota hoặc bị giới hạn. ` +
    `Vui lòng kiểm tra hạn mức tại console.cloud.google.com hoặc thêm API key mới.`
  );
}

// ── Phân loại lỗi từ Google GenAI SDK ─────────────────────────────────────────
function classifyError(error) {
  // Lấy toàn bộ thông tin lỗi dưới dạng string để dễ tìm kiếm
  const msg    = (error?.message || '').toLowerCase();
  const status = (error?.status  || error?.code || error?.statusCode || '').toString().toLowerCase();
  // Serialize toàn bộ error object để bắt các lỗi nested
  let raw = '';
  try { raw = JSON.stringify(error).toLowerCase(); } catch { raw = msg; }

  // ── 429 / Quota / Token exhausted ──────────────────────────────────────────
  const is429 =
    msg.includes('429')                    ||
    raw.includes('"code":429')             ||
    raw.includes('"code": 429')            ||
    status === '429'                       ||
    status === 'resource_exhausted'        ||
    raw.includes('resource_exhausted')     ||
    msg.includes('rate limit')             ||
    msg.includes('rate_limit')             ||
    msg.includes('ratelimit')              ||
    msg.includes('quota')                  ||
    msg.includes('exceeded')              ||
    msg.includes('too many requests')      ||
    msg.includes('tokens per')            ||   // "tokens per minute exceeded"
    msg.includes('requests per')          ||   // "requests per minute exceeded"
    msg.includes('daily limit')           ||
    msg.includes('billing')               ||   // "check your billing details"
    raw.includes('quota_exceeded')        ||
    raw.includes('dailylimitexceeded');

  // ── 503 / Server overloaded ──────────────────────────────────────────────
  const is503 =
    msg.includes('503')                    ||
    raw.includes('"code":503')             ||
    raw.includes('"code": 503')            ||
    status === '503'                       ||
    status === 'unavailable'               ||
    raw.includes('"unavailable"')          ||
    msg.includes('overloaded')             ||
    msg.includes('high demand')            ||
    msg.includes('service unavailable')    ||
    msg.includes('backend error')          ||
    msg.includes('temporarily unavailable');

  // Xác định lý do để hiển thị thông báo rõ hơn
  let reason = 'rate_limit';
  if (msg.includes('quota') || msg.includes('daily') || msg.includes('billing') || msg.includes('exceeded')) {
    reason = 'quota_exhausted';
  } else if (msg.includes('tokens per') || msg.includes('requests per')) {
    reason = 'rate_limit_per_minute';
  }

  return { is429, is503, reason };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
