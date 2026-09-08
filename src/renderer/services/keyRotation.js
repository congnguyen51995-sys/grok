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
 *  403 / PERMISSION_DENIED (key leaked / revoked / invalid)
 *    → Đánh dấu key đó là dead, bỏ qua vĩnh viễn, xoay sang key tiếp theo
 *    → Nếu tất cả key đều dead → throw lỗi ngay
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

  // Bắt đầu từ key ngẫu nhiên — tránh nhiều user cùng dùng key #0 một lúc
  let keyIdx      = Math.floor(Math.random() * keys.length);
  let cycles      = 0;
  let retries503  = 0;
  let lastError;

  // Số key đã được thử liên tiếp mà không thành công trong vòng hiện tại
  let keysTriedThisCycle = 0;

  // Set lưu index các key bị lỗi vĩnh viễn (leaked/revoked/invalid) — bỏ qua hoàn toàn
  const deadKeys = new Set();

  // Hàm lấy key tiếp theo không phải dead
  const nextLiveKeyIdx = (fromIdx) => {
    for (let i = 1; i <= keys.length; i++) {
      const idx = (fromIdx + i) % keys.length;
      if (!deadKeys.has(idx)) return idx;
    }
    return -1; // tất cả đều dead
  };

  while (cycles < maxCycles) {
    // Nếu key hiện tại đã bị đánh dead, tìm key tiếp theo
    if (deadKeys.has(keyIdx)) {
      const live = nextLiveKeyIdx(keyIdx);
      if (live === -1) break; // hết key sống
      keyIdx = live;
    }

    const key = keys[keyIdx];
    try {
      const result = await fn(key);
      return result; // ✅ Thành công
    } catch (error) {
      lastError = error;

      const { is429, is503, is403_permanent, reason } = classifyError(error);

      // ── HẾT TOKEN / QUOTA / RATE LIMIT ──────────────────────────────────────
      if (is429) {
        const nextIdx = (keyIdx + 1) % keys.length;
        onSwitch?.({ fromIdx: keyIdx, toIdx: nextIdx, total: keys.length, reason });
        keyIdx = nextIdx;
        keysTriedThisCycle++;
        retries503 = 0;

        // Delay nhỏ giữa các key switch để tránh hammer Gemini
        // (không delay nếu chỉ có 1 key)
        if (keys.length > 1) await sleep(150);

        // Đã thử hết tất cả keys trong vòng này
        if (keysTriedThisCycle >= keys.length) {
          cycles++;
          keysTriedThisCycle = 0;

          if (cycles < maxCycles) {
            // Chờ rồi thử lại — Gemini RPM reset sau ~60s
            const waitMs = 62000 + 10000 * (cycles - 1); // 62s, 72s, 82s, 92s
            onSwitch?.({ fromIdx: keyIdx, toIdx: keyIdx, total: keys.length, reason: `all_quota — đợi ${Math.round(waitMs/1000)}s để reset RPM (vòng ${cycles+1}/${maxCycles})` });
            await sleep(waitMs);
          }
        }
        continue;
      }

      // ── SERVER QUÁ TẢI (503) ─────────────────────────────────────────────────
      if (is503) {
        retries503++;
        if (retries503 > 12) {
          // Xoay key và reset đếm 503; nếu chỉ 1 key thì tính 1 cycle để tránh loop vô hạn
          const nextIdx = (keyIdx + 1) % keys.length;
          onSwitch?.({ fromIdx: keyIdx, toIdx: nextIdx, total: keys.length, reason: 'server_overloaded' });
          keyIdx = nextIdx;
          retries503 = 0;
          if (keys.length === 1) { cycles++; } // 1 key → phải tính cycle, không thì loop mãi
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

      // ── 403 VĨNH VIỄN (leaked / revoked / invalid / permission denied) ─────────
      if (is403_permanent) {
        console.warn(`[KeyRotation] Key ${keyIdx + 1} bị vô hiệu hóa vĩnh viễn (${reason}) — bỏ qua key này.`);
        deadKeys.add(keyIdx);
        const live = nextLiveKeyIdx(keyIdx);
        if (live === -1) {
          // Tất cả key đều dead
          throw new Error(
            `Tất cả ${keys.length} API key đều không hợp lệ (bị leaked, bị thu hồi hoặc không có quyền). ` +
            `Vui lòng kiểm tra và thay thế API key trong Settings.`
          );
        }
        onSwitch?.({ fromIdx: keyIdx, toIdx: live, total: keys.length, reason });
        keyIdx = live;
        keysTriedThisCycle++;
        // Không tính vào cycles — lỗi 403 là lỗi key, không phải quota
        if (keysTriedThisCycle >= keys.length - deadKeys.size) {
          // Đã thử hết key sống → báo lỗi
          throw new Error(
            `Tất cả ${keys.length} API key đều không hợp lệ hoặc đã hết quota. ` +
            `Vui lòng thêm API key mới trong Settings.`
          );
        }
        continue;
      }

      // ── LỖI KHÁC → NÉM RA NGAY ──────────────────────────────────────────────
      throw error;
    }
  }

  // Đã hết tất cả vòng thử → báo lỗi rõ ràng
  const liveCount = keys.length - deadKeys.size;
  throw new Error(
    `Tất cả ${liveCount > 0 ? liveCount : keys.length} API key đã hết quota hoặc bị giới hạn rate-limit. ` +
    `Vui lòng đợi ~1 phút rồi thử lại, hoặc thêm API key mới.`
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

  // ── 503 / Server overloaded / Timeout ───────────────────────────────────────
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
  // NOTE: TRANSCRIBE_TIMEOUT không nằm ở đây — nếu classify là 503,
  // với 1 key sẽ vòng lặp vô tận (rotate về key cũ, retries503 reset về 0).
  // Để nó là "lỗi khác" → keyRotation ném ngay → retryOnError (max 2 lần) xử lý.

  // ── 401 / 403 Vĩnh viễn (key không hợp lệ / bị thu hồi / sai loại token) ────
  const is403_permanent =
    raw.includes('"code":403')                      ||
    raw.includes('"code": 403')                     ||
    status === '403'                                ||
    status === 'permission_denied'                  ||
    raw.includes('permission_denied')               ||
    // 401 UNAUTHENTICATED — key sai hoặc là OAuth token thay vì API key
    raw.includes('"code":401')                      ||
    raw.includes('"code": 401')                     ||
    status === '401'                                ||
    status === 'unauthenticated'                    ||
    raw.includes('unauthenticated')                 ||
    raw.includes('access_token_type_unsupported')   ||
    raw.includes('invalid_credentials')             ||
    msg.includes('api key was reported as leaked')  ||
    msg.includes('api_key_invalid')                 ||
    msg.includes('invalid api key')                 ||
    msg.includes('api key not valid')               ||
    msg.includes('key has been revoked')            ||
    msg.includes('key expired')                     ||
    msg.includes('unauthorized')                    ||
    (msg.includes('403') && msg.includes('permission'));

  // Xác định lý do để hiển thị thông báo rõ hơn
  let reason = 'rate_limit';
  if (is403_permanent) {
    if (msg.includes('leaked'))   reason = 'key_leaked';
    else if (msg.includes('rev')) reason = 'key_revoked';
    else                          reason = 'key_invalid';
  } else if (msg.includes('quota') || msg.includes('daily') || msg.includes('billing') || msg.includes('exceeded')) {
    reason = 'quota_exhausted';
  } else if (msg.includes('tokens per') || msg.includes('requests per')) {
    reason = 'rate_limit_per_minute';
  }

  return { is429, is503, is403_permanent, reason };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
