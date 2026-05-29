// phone-sms/providers/nexsms.js — NexSMS 接码平台适配层
(function attachNexSmsProvider(root, factory) {
  root.PhoneSmsNexSmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createNexSmsProviderModule() {
  const PROVIDER_ID = 'nexsms';
  const DEFAULT_BASE_URL = 'https://api.nexsms.net';
  const DEFAULT_SERVICE_CODE = 'ot';
  const DEFAULT_SERVICE_LABEL = 'OpenAI';
  const DEFAULT_COUNTRY_ID = 1;
  const DEFAULT_COUNTRY_LABEL = 'Country #1';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_ACQUIRE_RETRY_ROUNDS = 3;
  const DEFAULT_ACQUIRE_RETRY_DELAY_MS = 2000;
  const DEFAULT_POLL_TIMEOUT_MS = 180000;
  const DEFAULT_POLL_INTERVAL_MS = 5000;
  const MAX_PRICE_CANDIDATES = 8;
  const PHONE_CODE_TIMEOUT_ERROR_PREFIX = 'PHONE_CODE_TIMEOUT::';
  const ACQUIRE_PRIORITY_COUNTRY = 'country';
  const ACQUIRE_PRIORITY_PRICE = 'price';
  const ACQUIRE_PRIORITY_PRICE_HIGH = 'price_high';

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      return new URL(trimmed).toString().replace(/\/+$/, '');
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function normalizeText(value = '', fallback = '') {
    return String(value || '').trim() || fallback;
  }

  function normalizeNexSmsCountryId(value, fallback = DEFAULT_COUNTRY_ID) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    const fallbackParsed = Math.floor(Number(fallback));
    if (Number.isFinite(fallbackParsed) && fallbackParsed >= 0) {
      return fallbackParsed;
    }
    return DEFAULT_COUNTRY_ID;
  }

  function normalizeNexSmsCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    return normalizeText(value, fallback);
  }

  function normalizeCountryKey(value) {
    const countryId = normalizeNexSmsCountryId(value, -1);
    return countryId >= 0 ? String(countryId) : '';
  }

  function normalizeNexSmsServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    if (normalized) {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    return fallbackNormalized || DEFAULT_SERVICE_CODE;
  }

  function normalizePriceLimit(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed * 10000) / 10000;
  }

  function normalizeAcquirePriority(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === ACQUIRE_PRIORITY_PRICE) {
      return ACQUIRE_PRIORITY_PRICE;
    }
    if (normalized === ACQUIRE_PRIORITY_PRICE_HIGH) {
      return ACQUIRE_PRIORITY_PRICE_HIGH;
    }
    return ACQUIRE_PRIORITY_COUNTRY;
  }

  function normalizeActivationRetryRounds(value) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ACQUIRE_RETRY_ROUNDS;
    }
    return Math.max(1, Math.min(10, parsed));
  }

  function normalizeActivationRetryDelayMs(value) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ACQUIRE_RETRY_DELAY_MS;
    }
    return Math.max(500, Math.min(30000, parsed));
  }

  function normalizeNexSmsCountryOrder(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\r\n,，;；]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const normalized = [];
    const seen = new Set();

    source.forEach((entry) => {
      let id = -1;
      let label = '';
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        id = normalizeNexSmsCountryId(entry.id ?? entry.countryId, -1);
        label = normalizeText(entry.label ?? entry.countryLabel, '');
      } else {
        const text = String(entry || '').trim();
        const structured = text.match(/^(\d+)\s*(?:[:|/-]\s*(.+))?$/);
        id = normalizeNexSmsCountryId(structured?.[1] || text, -1);
        label = normalizeText(structured?.[2], '');
      }
      if (id < 0 || seen.has(id)) {
        return;
      }
      seen.add(id);
      normalized.push({
        id,
        label: label || `Country #${id}`,
      });
    });

    return normalized.slice(0, 20);
  }

  function resolveCountryCandidates(state = {}) {
    const candidates = normalizeNexSmsCountryOrder(state?.nexSmsCountryOrder);
    if (candidates.length) {
      return candidates;
    }
    return [{
      id: normalizeNexSmsCountryId(state?.nexSmsCountryId, DEFAULT_COUNTRY_ID),
      label: normalizeNexSmsCountryLabel(state?.nexSmsCountryLabel, DEFAULT_COUNTRY_LABEL),
    }];
  }

  function resolveCountryLabel(state = {}, countryId = DEFAULT_COUNTRY_ID) {
    const countryKey = normalizeCountryKey(countryId);
    const matched = resolveCountryCandidates(state)
      .find((entry) => normalizeCountryKey(entry.id) === countryKey);
    return matched?.label || (countryKey ? `Country #${countryKey}` : DEFAULT_COUNTRY_LABEL);
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return '';
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  function describePayload(raw) {
    if (typeof raw === 'string') {
      return raw.trim();
    }
    if (raw && typeof raw === 'object') {
      const message = normalizeText(raw.message || raw.error || raw.msg || raw.statusText, '');
      if (message) {
        return message;
      }
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw);
      }
    }
    return String(raw || '').trim();
  }

  function isSuccessPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }
    return Number(payload.code) === 0;
  }

  function isNoNumbersError(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /numbers?\s+not\s+found|暂无可用|no\s+numbers|no\s+stock|库存.*0|not\s+available/i.test(text);
  }

  function isPendingMessage(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /no\s+sms|暂无短信|waiting|not\s+arrived|empty|未收到|短信为空|no\s+records/i.test(text);
  }

  function isTerminalError(payloadOrMessage, status = 0) {
    if (Number(status) === 401 || Number(status) === 403) {
      return true;
    }
    const text = describePayload(payloadOrMessage);
    return /invalid\s*api\s*key|bad[_\s-]*key|wrong[_\s-]*key|unauthorized|forbidden|no\s*balance|insufficient\s*balance|余额不足|账号.*封禁|banned/i.test(text);
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: normalizeText(state?.nexSmsApiKey),
      baseUrl: normalizeBaseUrl(state?.nexSmsBaseUrl || DEFAULT_BASE_URL),
      serviceCode: normalizeNexSmsServiceCode(state?.nexSmsServiceCode, DEFAULT_SERVICE_CODE),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  async function fetchPayload(config, path, actionLabel, options = {}) {
    if (!config.fetchImpl) {
      throw new Error('NexSMS 网络请求实现不可用。');
    }
    if (!config.apiKey) {
      throw new Error('NexSMS API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;

    try {
      const method = String(options.method || 'GET').trim().toUpperCase() || 'GET';
      const requestUrl = new URL(path.replace(/^\/+/, ''), `${config.baseUrl.replace(/\/+$/, '')}/`);
      requestUrl.searchParams.set('apiKey', config.apiKey);
      Object.entries(options.query || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        requestUrl.searchParams.set(key, String(value));
      });
      const headers = {
        Accept: 'application/json',
        ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
      };
      const requestInit = {
        method,
        headers,
        signal: controller?.signal,
      };
      if (method !== 'GET' && method !== 'HEAD' && options.body !== undefined) {
        requestInit.body = typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
        if (!requestInit.headers['Content-Type']) {
          requestInit.headers['Content-Type'] = 'application/json';
        }
      }
      const response = await config.fetchImpl(requestUrl.toString(), requestInit);
      const text = await response.text();
      const payload = parsePayload(text);
      if (!response.ok) {
        const error = new Error(`${actionLabel}失败：${describePayload(payload) || response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${actionLabel}超时。`);
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async function fetchBalance(state = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, '/api/user/getBalance', 'NexSMS get balance');
    if (!isSuccessPayload(payload)) {
      throw new Error(`NexSMS get balance 失败：${describePayload(payload) || 'empty response'}`);
    }
    const balance = Number(payload?.data?.balance);
    return {
      balance: Number.isFinite(balance) ? balance : null,
      raw: payload,
    };
  }

  async function fetchPrices(state = {}, countryConfig = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const countryId = normalizeNexSmsCountryId(countryConfig?.id, DEFAULT_COUNTRY_ID);
    return fetchPayload(config, '/api/getCountryByService', 'NexSMS getCountryByService', {
      query: {
        serviceCode: config.serviceCode,
        countryId,
      },
    });
  }

  function buildSortedUniquePriceCandidates(values = []) {
    return Array.from(
      new Set(
        values
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.round(value * 10000) / 10000)
      )
    )
      .sort((left, right) => left - right)
      .slice(0, MAX_PRICE_CANDIDATES);
  }

  function collectPriceCandidates(countryData = {}) {
    const candidates = [];
    const pushCandidate = (value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        candidates.push(Math.round(numeric * 10000) / 10000);
      }
    };
    pushCandidate(countryData.minPrice);
    pushCandidate(countryData.medianPrice);
    pushCandidate(countryData.maxPrice);
    if (countryData.priceMap && typeof countryData.priceMap === 'object') {
      Object.entries(countryData.priceMap).forEach(([priceKey, count]) => {
        const availableCount = Number(count);
        if (!Number.isFinite(availableCount) || availableCount <= 0) {
          return;
        }
        pushCandidate(priceKey);
      });
    }
    return buildSortedUniquePriceCandidates(candidates);
  }

  function resolvePriceRange(state = {}) {
    const minPriceLimit = normalizePriceLimit(state?.nexSmsMinPrice ?? state?.heroSmsMinPrice);
    const maxPriceLimit = normalizePriceLimit(state?.nexSmsMaxPrice ?? state?.heroSmsMaxPrice);
    return {
      minPriceLimit,
      maxPriceLimit,
      hasMinPriceLimit: minPriceLimit !== null,
      hasMaxPriceLimit: maxPriceLimit !== null,
      invalidRange: minPriceLimit !== null && maxPriceLimit !== null && minPriceLimit > maxPriceLimit,
    };
  }

  function isPriceWithinRange(price, minPriceLimit = null, maxPriceLimit = null) {
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return false;
    }
    const normalized = Math.round(numeric * 10000) / 10000;
    if (minPriceLimit !== null && normalized < minPriceLimit) {
      return false;
    }
    if (maxPriceLimit !== null && normalized > maxPriceLimit) {
      return false;
    }
    return true;
  }

  function filterPriceCandidatesWithinRange(prices = [], minPriceLimit = null, maxPriceLimit = null) {
    return (Array.isArray(prices) ? prices : []).filter((price) => (
      isPriceWithinRange(price, minPriceLimit, maxPriceLimit)
    ));
  }

  function filterPriceCandidatesAboveFloor(prices = [], minExclusivePrice = null) {
    const floor = normalizePriceLimit(minExclusivePrice);
    if (floor === null || floor <= 0) {
      return Array.isArray(prices) ? [...prices] : [];
    }
    return (Array.isArray(prices) ? prices : []).filter((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > floor;
    });
  }

  function reorderPriceCandidates(prices = [], acquirePriority = ACQUIRE_PRIORITY_COUNTRY, preferredPrice = null) {
    const ordered = buildSortedUniquePriceCandidates(prices);
    if (acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH) {
      ordered.reverse();
    }
    const preferred = normalizePriceLimit(preferredPrice);
    if (preferred === null) {
      return ordered;
    }
    return [preferred, ...ordered.filter((price) => price !== preferred)];
  }

  function normalizePriceFloorMap(rawMap = {}, normalizeCountryKey) {
    const normalizedMap = new Map();
    if (!rawMap || typeof rawMap !== 'object') {
      return normalizedMap;
    }
    Object.entries(rawMap).forEach(([rawCountryKey, rawPrice]) => {
      const countryKey = String(
        typeof normalizeCountryKey === 'function'
          ? normalizeCountryKey(rawCountryKey)
          : rawCountryKey
      ).trim();
      if (!countryKey) {
        return;
      }
      const normalizedPrice = normalizePriceLimit(rawPrice);
      if (normalizedPrice === null || normalizedPrice <= 0) {
        return;
      }
      normalizedMap.set(countryKey, normalizedPrice);
    });
    return normalizedMap;
  }

  function formatPriceRangeText(minPriceLimit = null, maxPriceLimit = null) {
    const minPrice = normalizePriceLimit(minPriceLimit);
    const maxPrice = normalizePriceLimit(maxPriceLimit);
    if (minPrice !== null && maxPrice !== null) {
      return `${minPrice}~${maxPrice}`;
    }
    if (minPrice !== null) {
      return `${minPrice}~`;
    }
    if (maxPrice !== null) {
      return `~${maxPrice}`;
    }
    return 'unbounded';
  }

  async function resolveCountryPricePlan(state = {}, countryConfig = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const countryId = normalizeNexSmsCountryId(countryConfig?.id, -1);
    if (countryId < 0) {
      throw new Error(`NexSMS 国家 ID 无效：${countryConfig?.id}`);
    }
    const payload = await fetchPayload(config, '/api/getCountryByService', 'NexSMS getCountryByService', {
      query: {
        serviceCode: config.serviceCode,
        countryId,
      },
    });
    if (!isSuccessPayload(payload)) {
      throw new Error(`NexSMS getCountryByService 失败：${describePayload(payload) || 'empty response'}`);
    }
    const countryData = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload.data || {})
      : {};
    const countryLabel = normalizeNexSmsCountryLabel(
      countryData.countryName || countryConfig?.label,
      `Country #${countryId}`
    );
    const prices = collectPriceCandidates(countryData);
    const minCatalogPrice = prices.length
      ? prices[0]
      : (() => {
        const minPrice = Number(countryData.minPrice);
        return Number.isFinite(minPrice) && minPrice > 0
          ? Math.round(minPrice * 10000) / 10000
          : null;
      })();
    const priceRange = resolvePriceRange(state);
    const filteredPrices = filterPriceCandidatesWithinRange(
      prices,
      priceRange.minPriceLimit,
      priceRange.maxPriceLimit
    );
    return {
      countryId,
      countryLabel,
      prices: filteredPrices,
      userLimit: priceRange.maxPriceLimit,
      minCatalogPrice,
      rawPayload: payload,
    };
  }

  function normalizeActivation(payload, fallback = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {};
    const data = isSuccessPayload(source) ? (source.data || {}) : source;
    const phoneCandidates = Array.isArray(data.phoneNumbers)
      ? data.phoneNumbers
      : (Array.isArray(data.numbers) ? data.numbers : []);
    const phoneNumber = normalizeText(
      data.phoneNumber
      || data.phone
      || phoneCandidates[0]
      || source.phoneNumber
      || source.phone
      || fallback.phoneNumber
    );
    if (!phoneNumber) {
      return null;
    }
    const countryId = normalizeNexSmsCountryId(
      data.countryId ?? source.countryId ?? fallback.countryId,
      DEFAULT_COUNTRY_ID
    );
    return {
      activationId: normalizeText(data.activationId || source.activationId || fallback.activationId, phoneNumber),
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeNexSmsServiceCode(
        data.serviceCode || source.serviceCode || fallback.serviceCode || DEFAULT_SERVICE_CODE,
        DEFAULT_SERVICE_CODE
      ),
      countryId,
      countryLabel: normalizeNexSmsCountryLabel(
        data.countryName || source.countryName || data.countryLabel || source.countryLabel || fallback.countryLabel,
        `Country #${countryId}`
      ),
      successfulUses: Math.max(0, Math.floor(Number(fallback.successfulUses) || 0)),
      maxUses: 1,
      ...(fallback.selectedPrice !== undefined ? { selectedPrice: Number(fallback.selectedPrice) } : {}),
      ...(fallback.price !== undefined ? { price: Number(fallback.price) } : {}),
      ...(fallback.maxPrice !== undefined ? { maxPrice: Number(fallback.maxPrice) } : {}),
    };
  }

  function resolveActivationCountry(activation = {}, state = {}) {
    const normalizedActivation = normalizeActivation(activation)
      || (activation && typeof activation === 'object' ? activation : {});
    const countryId = normalizeNexSmsCountryId(
      normalizedActivation.countryId ?? normalizedActivation.country,
      DEFAULT_COUNTRY_ID
    );
    const matched = resolveCountryCandidates(state)
      .find((entry) => normalizeNexSmsCountryId(entry.id, -1) === countryId);
    if (matched) {
      return matched;
    }
    return {
      id: countryId,
      label: normalizeNexSmsCountryLabel(normalizedActivation.countryLabel, `Country #${countryId}`),
    };
  }

  function getActivationCountryKey(activation = {}) {
    return normalizeCountryKey(activation?.countryId ?? activation?.country);
  }

  function getActivationPrice(activation = {}) {
    return Number.isFinite(Number(activation?.selectedPrice))
      ? Math.round(Number(activation.selectedPrice) * 10000) / 10000
      : null;
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const allCountryCandidates = resolveCountryCandidates(state);
    if (!allCountryCandidates.length) {
      throw new Error('步骤 9：NexSMS 未选择国家，请先在接码设置中至少选择 1 个国家。');
    }
    const blockedCountryIds = new Set(
      (Array.isArray(options?.blockedCountryIds) ? options.blockedCountryIds : [])
        .map((value) => normalizeNexSmsCountryId(value, -1))
        .filter((id) => id >= 0)
    );
    let countryCandidates = allCountryCandidates.filter((entry) => {
      const id = normalizeNexSmsCountryId(entry.id, -1);
      return id >= 0 && !blockedCountryIds.has(id);
    });
    if (!countryCandidates.length) {
      countryCandidates = allCountryCandidates;
      if (blockedCountryIds.size && typeof deps.addLog === 'function') {
        await deps.addLog('步骤 9：已选国家均达到临时收码失败跳过阈值，本轮解除跳过并重新尝试。', 'warn');
      }
    }
    const acquirePriority = normalizeAcquirePriority(state?.heroSmsAcquirePriority);
    const priceRange = resolvePriceRange(state);
    if (priceRange.invalidRange) {
      throw new Error(`NexSMS 价格区间无效：最低购买价 ${priceRange.minPriceLimit} 高于价格上限 ${priceRange.maxPriceLimit}。`);
    }
    const hasPriceBounds = priceRange.hasMinPriceLimit || priceRange.hasMaxPriceLimit;
    const preferredPriceTier = normalizePriceLimit(state?.heroSmsPreferredPrice);
    const countryPriceFloorByCountryId = normalizePriceFloorMap(
      options?.countryPriceFloorByCountryId,
      (value) => String(normalizeNexSmsCountryId(value, -1))
    );
    const maxAcquireRounds = Math.max(2, normalizeActivationRetryRounds(state?.heroSmsActivationRetryRounds));
    const retryDelayMs = normalizeActivationRetryDelayMs(state?.heroSmsActivationRetryDelayMs);
    let finalNoNumbersByCountry = [];
    let finalLastError = null;

    for (let round = 1; round <= maxAcquireRounds; round += 1) {
      if (maxAcquireRounds > 1 && typeof deps.addLog === 'function') {
        await deps.addLog(`步骤 9：NexSMS 正在获取手机号（第 ${round}/${maxAcquireRounds} 轮）...`, 'info');
      }
      const candidateAttempts = countryCandidates.map((countryConfig, index) => ({
        index,
        countryConfig,
        pricePlan: null,
        orderingPrice: Number.POSITIVE_INFINITY,
      }));
      if (
        (acquirePriority === ACQUIRE_PRIORITY_PRICE || acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH)
        && candidateAttempts.length > 1
      ) {
        for (const attempt of candidateAttempts) {
          try {
            const pricePlan = await resolveCountryPricePlan(state, attempt.countryConfig, deps);
            attempt.pricePlan = pricePlan;
            const orderedForRanking = reorderPriceCandidates(pricePlan.prices, acquirePriority, preferredPriceTier);
            const rangeFilteredForRanking = filterPriceCandidatesWithinRange(
              orderedForRanking,
              priceRange.minPriceLimit,
              priceRange.maxPriceLimit
            );
            const rankingPrices = rangeFilteredForRanking.length
              ? rangeFilteredForRanking
              : (hasPriceBounds ? [] : orderedForRanking);
            attempt.orderingPrice = Array.isArray(rankingPrices) && rankingPrices.length
              ? Number(rankingPrices[0])
              : Number.POSITIVE_INFINITY;
          } catch (error) {
            attempt.lookupError = error;
          }
        }
        candidateAttempts.sort((left, right) => {
          if (left.orderingPrice !== right.orderingPrice) {
            return acquirePriority === ACQUIRE_PRIORITY_PRICE_HIGH
              ? (right.orderingPrice - left.orderingPrice)
              : (left.orderingPrice - right.orderingPrice);
          }
          return left.index - right.index;
        });
        if (typeof deps.addLog === 'function') {
          const rankingSummary = candidateAttempts.map((attempt) => {
            const id = normalizeNexSmsCountryId(attempt.countryConfig.id, -1);
            const label = normalizeText(attempt.countryConfig.label, `Country #${id}`);
            return Number.isFinite(attempt.orderingPrice)
              ? `${label}:${attempt.orderingPrice}`
              : `${label}:无`;
          }).join(' | ');
          await deps.addLog(`步骤 9：NexSMS 价格优先排序：${rankingSummary}`, 'info');
        }
      }

      const noNumbersByCountry = [];
      const retryableNoNumberCountries = [];
      let lastError = null;
      for (const attempt of candidateAttempts) {
        const countryId = normalizeNexSmsCountryId(attempt.countryConfig.id, -1);
        const countryLabel = normalizeNexSmsCountryLabel(attempt.countryConfig.label, `Country #${countryId}`);
        const countryPriceFloor = countryPriceFloorByCountryId.get(String(countryId)) ?? null;
        let pricePlan = attempt.pricePlan;
        if (!pricePlan) {
          try {
            pricePlan = await resolveCountryPricePlan(state, attempt.countryConfig, deps);
          } catch (error) {
            if (isTerminalError(error?.payload || error?.message, error?.status)) {
              throw new Error(`NexSMS price lookup 失败：${describePayload(error?.payload || error?.message) || 'unknown terminal error'}`);
            }
            lastError = error;
            continue;
          }
        }
        if (!Array.isArray(pricePlan.prices) || !pricePlan.prices.length) {
          if (
            pricePlan.userLimit !== null
            && pricePlan.minCatalogPrice !== null
            && pricePlan.minCatalogPrice > pricePlan.userLimit
          ) {
            noNumbersByCountry.push(`${countryLabel}: 价格上限 ${pricePlan.userLimit} 内暂无可用号码；平台最低价=${pricePlan.minCatalogPrice}`);
          } else {
            const reason = describePayload(pricePlan.rawPayload) || '无可用价格档位';
            noNumbersByCountry.push(`${countryLabel}: ${reason}`);
            retryableNoNumberCountries.push(countryLabel);
          }
          continue;
        }
        const orderedPrices = reorderPriceCandidates(pricePlan.prices, acquirePriority, preferredPriceTier);
        const rangeFilteredPrices = filterPriceCandidatesWithinRange(
          orderedPrices,
          priceRange.minPriceLimit,
          priceRange.maxPriceLimit
        );
        const candidatePrices = rangeFilteredPrices.length
          ? rangeFilteredPrices
          : (hasPriceBounds ? [] : orderedPrices);
        const floorFilteredPrices = filterPriceCandidatesAboveFloor(candidatePrices, countryPriceFloor);
        const hasCountryPriceFloor = (
          countryPriceFloor !== null
          && Number.isFinite(Number(countryPriceFloor))
          && Number(countryPriceFloor) > 0
        );
        const hasAlternativeCountries = candidateAttempts.some((entry) => (
          normalizeNexSmsCountryId(entry?.countryConfig?.id, -1)
          !== normalizeNexSmsCountryId(attempt?.countryConfig?.id, -1)
        ));
        const pricesToTry = hasCountryPriceFloor
          ? (floorFilteredPrices.length ? floorFilteredPrices : (hasAlternativeCountries ? [] : candidatePrices.slice(0, 1)))
          : (floorFilteredPrices.length ? floorFilteredPrices : candidatePrices);
        if (!pricesToTry.length) {
          if (priceRange.hasMinPriceLimit && !rangeFilteredPrices.length) {
            noNumbersByCountry.push(`${countryLabel}: 价格区间 ${formatPriceRangeText(priceRange.minPriceLimit, priceRange.maxPriceLimit)} 内暂无可用号码`);
            continue;
          }
          if (
            countryPriceFloor !== null
            && Array.isArray(pricePlan.prices)
            && pricePlan.prices.length > 0
          ) {
            noNumbersByCountry.push(`${countryLabel}: 当前回退尝试没有高于 ${countryPriceFloor} 的价格档位`);
          } else {
            noNumbersByCountry.push(`${countryLabel}: ${describePayload(pricePlan.rawPayload) || '暂无可用号码'}`);
            retryableNoNumberCountries.push(countryLabel);
          }
          continue;
        }
        let boughtActivation = null;
        for (const price of pricesToTry) {
          try {
            const payload = await fetchPayload(config, '/api/order/purchase', 'NexSMS purchase', {
              method: 'POST',
              body: {
                serviceCode: config.serviceCode,
                countryId,
                quantity: 1,
                price,
              },
            });
            if (!isSuccessPayload(payload)) {
              if (isNoNumbersError(payload)) {
                continue;
              }
              if (isTerminalError(payload)) {
                throw new Error(`NexSMS purchase 失败：${describePayload(payload) || 'empty response'}`);
              }
              lastError = new Error(`NexSMS purchase 失败：${describePayload(payload) || 'empty response'}`);
              continue;
            }
            boughtActivation = normalizeActivation(payload, {
              countryId,
              countryLabel,
              serviceCode: config.serviceCode,
              selectedPrice: price,
            });
            if (!boughtActivation) {
              lastError = new Error('NexSMS 购买成功，但未返回手机号。');
              continue;
            }
            return boughtActivation;
          } catch (error) {
            if (isTerminalError(error?.payload || error?.message, error?.status)) {
              throw new Error(`NexSMS purchase 失败：${describePayload(error?.payload || error?.message) || 'unknown terminal error'}`);
            }
            if (isNoNumbersError(error?.payload || error?.message)) {
              continue;
            }
            lastError = error;
          }
        }
        if (!boughtActivation) {
          const fallbackReason = describePayload(pricePlan.rawPayload) || '暂无可用号码';
          noNumbersByCountry.push(`${countryLabel}: ${fallbackReason}`);
          retryableNoNumberCountries.push(countryLabel);
        }
      }
      finalNoNumbersByCountry = noNumbersByCountry;
      finalLastError = lastError;
      if (
        noNumbersByCountry.length
        && round < maxAcquireRounds
        && retryableNoNumberCountries.length > 0
      ) {
        if (typeof deps.addLog === 'function') {
          await deps.addLog(
            `步骤 9：NexSMS 暂无可用号码（第 ${round}/${maxAcquireRounds} 轮）；${Math.ceil(retryDelayMs / 1000)} 秒后重试。国家：${retryableNoNumberCountries.join(', ')}。`,
            'warn'
          );
        }
        await deps.sleepWithStop?.(retryDelayMs);
        continue;
      }
      break;
    }

    if (finalNoNumbersByCountry.length) {
      throw new Error(`NexSMS 已尝试 ${countryCandidates.length} 个候选国家，均无可用号码：${finalNoNumbersByCountry.join(' | ')}。`);
    }
    if (finalLastError) {
      throw finalLastError;
    }
    throw new Error('NexSMS 获取手机号失败。');
  }

  function extractVerificationCode(value = '') {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }
    return text.match(/\b(\d{4,8})\b/)?.[1] || '';
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      throw new Error('缺少手机号接码订单。');
    }
    const config = resolveConfig(state, deps);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_POLL_TIMEOUT_MS);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_POLL_INTERVAL_MS);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';

    const emitWaitingForCode = async (statusText) => {
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText,
          timeoutMs,
        });
      }
    };

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      deps.throwIfStopped?.();
      const payload = await fetchPayload(config, '/api/sms/messages', 'NexSMS get sms messages', {
        query: {
          phoneNumber: normalizedActivation.phoneNumber,
          format: 'json_latest',
        },
      });
      const text = describePayload(payload);
      lastResponse = text;
      pollCount += 1;
      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: text || 'PENDING',
          timeoutMs,
        });
      }
      if (isSuccessPayload(payload)) {
        const code = extractVerificationCode(payload?.data?.code || payload?.data?.text || payload?.data?.message || '');
        if (code) {
          return code;
        }
        await emitWaitingForCode(text || 'PENDING');
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }
      if (isPendingMessage(payload)) {
        await emitWaitingForCode(text || 'PENDING');
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }
      if (isTerminalError(payload)) {
        throw new Error(`NexSMS get sms messages 失败：${text || 'unknown terminal error'}`);
      }
      await emitWaitingForCode(text || 'PENDING');
      await deps.sleepWithStop?.(intervalMs);
    }
    throw new Error(`${PHONE_CODE_TIMEOUT_ERROR_PREFIX}等待手机验证码超时。${lastResponse ? ` NexSMS 最后状态：${lastResponse}` : ''}`);
  }

  async function closeActivation(state = {}, activation, deps = {}, actionLabel = 'NexSMS close activation') {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      return '';
    }
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, '/api/close/activation', actionLabel, {
      method: 'POST',
      body: {
        phoneNumber: normalizedActivation.phoneNumber,
      },
    });
    if (!isSuccessPayload(payload)) {
      throw new Error(`NexSMS close activation 失败：${describePayload(payload) || 'empty response'}`);
    }
    return describePayload(payload);
  }

  async function reuseActivation() {
    throw new Error('NexSMS 当前流程不支持复用手机号订单。');
  }

  async function finishActivation() {
    return 'NexSMS complete skipped';
  }

  async function cancelActivation(state = {}, activation, deps = {}) {
    return closeActivation(state, activation, deps, 'NexSMS close activation');
  }

  async function banActivation(state = {}, activation, deps = {}) {
    return closeActivation(state, activation, deps, 'NexSMS close activation');
  }

  async function requestAdditionalSms() {
    return '';
  }

  async function rotateActivation(state = {}, activation, options = {}, deps = {}) {
    const releaseAction = String(options?.releaseAction || '').trim().toLowerCase() === 'ban'
      ? 'ban'
      : 'cancel';
    if (releaseAction === 'ban') {
      await banActivation(state, activation, deps);
    } else {
      await cancelActivation(state, activation, deps);
    }
    return {
      currentTicketId: String(activation?.activationId || activation?.phoneNumber || ''),
      nextActivation: null,
    };
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      fetchImpl: deps.fetchImpl,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
      addLog: deps.addLog,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
    const capabilities = Object.freeze({
      supportsReusableActivation: false,
      supportsAutomaticFreeReuse: false,
      supportsFreeReusePreservation: false,
      supportsPageResend: true,
      supportsPageResendProbe: true,
      requiresCountrySelection: true,
    });
    return {
      id: PROVIDER_ID,
      label: 'NexSMS',
      capabilities,
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId: normalizeNexSmsCountryId,
      normalizeCountryLabel: normalizeNexSmsCountryLabel,
      normalizeCountryOrder: normalizeNexSmsCountryOrder,
      normalizeCountryKey,
      normalizeServiceCode: normalizeNexSmsServiceCode,
      normalizeActivation,
      resolveCountryCandidates,
      resolveCountryLabel,
      resolveActivationCountry,
      getActivationCountryKey,
      getActivationPrice,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => finishActivation(state, activation, providerDeps),
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => banActivation(state, activation, providerDeps),
      requestAdditionalSms: (state, activation) => requestAdditionalSms(state, activation, providerDeps),
      rotateActivation: (state, activation, options) => rotateActivation(state, activation, options, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      prepareActivationForReuse: reuseActivation,
      canPersistReusableActivation: () => false,
      canPreserveActivationForFreeReuse: () => false,
      shouldUsePageResend: () => true,
      shouldProbePageResend: () => true,
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      fetchPrices: (state, countryConfig) => fetchPrices(state, countryConfig, providerDeps),
      resolveCountryPricePlan: (state, countryConfig) => resolveCountryPricePlan(state, countryConfig, providerDeps),
      resolvePriceRange,
      formatPriceRangeText,
      describePayload,
      isSuccessPayload,
      isNoNumbersError,
      isPendingMessage,
      isTerminalError,
    };
  }

  return {
    PROVIDER_ID,
    DEFAULT_BASE_URL,
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    createProvider,
    describePayload,
    isSuccessPayload,
    normalizeNexSmsCountryId,
    normalizeNexSmsCountryLabel,
    normalizeNexSmsCountryOrder,
    normalizeCountryKey,
    normalizeNexSmsServiceCode,
    normalizeActivation,
    resolveActivationCountry,
  };
});
