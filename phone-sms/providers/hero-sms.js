// phone-sms/providers/hero-sms.js — HeroSMS 接码平台适配层
(function attachHeroSmsProvider(root, factory) {
  root.PhoneSmsHeroSmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createHeroSmsProviderModule() {
  const PROVIDER_ID = 'hero-sms';
  const DEFAULT_BASE_URL = 'https://hero-sms.com/stubs/handler_api.php';
  const DEFAULT_SERVICE_CODE = 'dr';
  const DEFAULT_SERVICE_LABEL = 'OpenAI';
  const DEFAULT_COUNTRY_ID = 52;
  const DEFAULT_COUNTRY_LABEL = 'Thailand';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_OPERATOR = 'any';
  const DEFAULT_MAX_USES = 3;
  const DEFAULT_PRICE_LOOKUP_ATTEMPTS = 3;
  const DEFAULT_ACQUIRE_RETRY_ROUNDS = 3;
  const DEFAULT_ACQUIRE_RETRY_DELAY_MS = 2000;
  const DEFAULT_POLL_TIMEOUT_MS = 180000;
  const DEFAULT_POLL_INTERVAL_MS = 5000;
  const MAX_PRICE_CANDIDATES = 8;
  const PHONE_CODE_TIMEOUT_ERROR_PREFIX = 'PHONE_CODE_TIMEOUT::';
  const HERO_SMS_ACQUIRE_PRIORITY_COUNTRY = 'country';
  const HERO_SMS_ACQUIRE_PRIORITY_PRICE = 'price';
  const HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH = 'price_high';
  const COUNTRY_BY_PHONE_PREFIX = Object.freeze([
    { prefix: '84', id: 10, iso: 'VN', label: 'Vietnam' },
    { prefix: '66', id: 52, iso: 'TH', label: 'Thailand' },
    { prefix: '62', id: 6, iso: 'ID', label: 'Indonesia' },
    { prefix: '44', id: 16, iso: 'GB', label: 'United Kingdom' },
    { prefix: '81', id: 151, iso: 'JP', label: 'Japan' },
    { prefix: '49', id: 43, iso: 'DE', label: 'Germany' },
    { prefix: '33', id: 73, iso: 'FR', label: 'France' },
    { prefix: '1', id: 187, iso: 'US', label: 'USA' },
  ]);

  function normalizeHeroSmsCountryId(value, fallback = DEFAULT_COUNTRY_ID) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const fallbackParsed = Math.floor(Number(fallback));
    return Number.isFinite(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : DEFAULT_COUNTRY_ID;
  }

  function normalizeOptionalHeroSmsCountryId(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeHeroSmsCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    return String(value || '').trim() || fallback;
  }

  function normalizeCountryKey(value) {
    const countryId = normalizeHeroSmsCountryId(value, 0);
    return countryId > 0 ? String(countryId) : '';
  }

  function inferCountryFromPhoneNumber(phoneNumber = '') {
    const digits = String(phoneNumber || '').replace(/\D+/g, '');
    if (!digits) {
      return null;
    }
    const match = COUNTRY_BY_PHONE_PREFIX.find((entry) => digits.startsWith(entry.prefix));
    if (!match) {
      return null;
    }
    return {
      id: normalizeHeroSmsCountryId(match.id, 0),
      iso: match.iso,
      label: normalizeHeroSmsCountryLabel(match.label, `Country #${match.id}`),
    };
  }

  function normalizeHeroSmsMaxPrice(value = '') {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return '';
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return String(Math.round(numeric * 10000) / 10000);
  }

  function normalizeHeroSmsPrice(value) {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct >= 0) {
      return direct;
    }
    const text = String(value ?? '').trim();
    if (!text) {
      return null;
    }
    const matched = text.match(/-?\d+(?:[.,]\d+)?/);
    if (!matched) {
      return null;
    }
    const parsed = Number(String(matched[0] || '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function normalizeHeroSmsPriceLimit(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed * 10000) / 10000;
  }

  function normalizeHeroSmsOperator(value = '', fallback = DEFAULT_OPERATOR) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '');
    if (normalized) {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '');
    return fallbackNormalized || DEFAULT_OPERATOR;
  }

  function normalizeHeroSmsAcquirePriority(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === HERO_SMS_ACQUIRE_PRIORITY_PRICE) {
      return HERO_SMS_ACQUIRE_PRIORITY_PRICE;
    }
    if (normalized === HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH) {
      return HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH;
    }
    return HERO_SMS_ACQUIRE_PRIORITY_COUNTRY;
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

  function normalizeHeroSmsCountryFallback(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\r\n,，;；]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
      let id = 0;
      let label = '';
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        id = normalizeHeroSmsCountryId(entry.id ?? entry.countryId, 0);
        label = String((entry.label ?? entry.countryLabel) || '').trim();
      } else {
        const text = String(entry || '').trim();
        const structured = text.match(/^(\d+)\s*(?:[:|/-]\s*(.+))?$/);
        id = normalizeHeroSmsCountryId(structured?.[1] || text, 0);
        label = String(structured?.[2] || '').trim();
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({ id, label: label || `Country #${id}` });
      if (normalized.length >= 20) break;
    }
    return normalized;
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      return new URL(trimmed).toString();
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function buildUrl(config = {}, query = {}) {
    const url = new URL(normalizeBaseUrl(config.baseUrl));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { return trimmed; }
    }
    return trimmed;
  }

  function describePayload(raw) {
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
      const direct = String(raw.message || raw.msg || raw.error || raw.title || raw.status || '').trim();
      if (direct) return direct;
      try { return JSON.stringify(raw); } catch { return String(raw); }
    }
    return String(raw || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.heroSmsApiKey || '').trim(),
      baseUrl: state.heroSmsBaseUrl || DEFAULT_BASE_URL,
      operator: normalizeHeroSmsOperator(state.heroSmsOperator, DEFAULT_OPERATOR),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  function assertApiKey(config) {
    if (!config.apiKey) {
      throw new Error('HeroSMS API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
  }

  async function fetchPayload(config, query, actionLabel = 'HeroSMS request') {
    assertApiKey(config);
    if (query.api_key === undefined && config.apiKey) {
      query = { api_key: config.apiKey, ...query };
    }
    if (!config.fetchImpl) {
      throw new Error('HeroSMS 网络请求实现不可用。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const response = await config.fetchImpl(buildUrl(config, query), {
        method: 'GET',
        signal: controller?.signal,
      });
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
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function resolveCountryConfig(state = {}) {
    const hasExplicitPrimaryCountry = Object.prototype.hasOwnProperty.call(state || {}, 'heroSmsCountryId');
    const fallbackList = normalizeHeroSmsCountryFallback(state.heroSmsCountryFallback);
    const primaryCountryId = normalizeOptionalHeroSmsCountryId(state.heroSmsCountryId);
    if (primaryCountryId > 0) {
      return {
        id: primaryCountryId,
        label: normalizeHeroSmsCountryLabel(state.heroSmsCountryLabel),
      };
    }
    if (hasExplicitPrimaryCountry) {
      if (fallbackList.length) {
        const firstFallback = fallbackList[0];
        return {
          id: normalizeOptionalHeroSmsCountryId(firstFallback.id),
          label: normalizeHeroSmsCountryLabel(firstFallback.label, `Country #${firstFallback.id}`),
        };
      }
      return null;
    }
    return {
      id: normalizeHeroSmsCountryId(DEFAULT_COUNTRY_ID, DEFAULT_COUNTRY_ID),
      label: normalizeHeroSmsCountryLabel(state.heroSmsCountryLabel),
    };
  }

  function resolveCountryCandidates(state = {}) {
    const primary = resolveCountryConfig(state);
    const fallbackList = normalizeHeroSmsCountryFallback(state.heroSmsCountryFallback);
    if (!primary || !Number.isFinite(primary.id) || primary.id <= 0) {
      return fallbackList
        .map((entry) => ({
          id: normalizeOptionalHeroSmsCountryId(entry.id),
          label: normalizeHeroSmsCountryLabel(entry.label, `Country #${entry.id}`),
        }))
        .filter((entry) => entry.id > 0);
    }
    const seen = new Set([primary.id]);
    const candidates = [primary];
    fallbackList.forEach((entry) => {
      const id = normalizeOptionalHeroSmsCountryId(entry.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      candidates.push({ id, label: normalizeHeroSmsCountryLabel(entry.label, `Country #${id}`) });
    });
    return candidates;
  }

  async function fetchBalance(state = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    if (!config.apiKey) {
      throw new Error('HeroSMS API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    const payload = await fetchPayload(config, { action: 'getBalance' }, 'HeroSMS getBalance');
    const balance = Number(String(describePayload(payload)).replace(/^ACCESS_BALANCE:/i, '').trim());
    return { balance, raw: payload };
  }

  async function fetchPrices(state = {}, countryConfig = resolveCountryConfig(state), deps = {}) {
    const config = resolveConfig(state, deps);
    return fetchPayload(config, {
      action: 'getPrices',
      service: DEFAULT_SERVICE_CODE,
      country: normalizeHeroSmsCountryId(countryConfig?.id),
    }, 'HeroSMS getPrices');
  }

  function shouldUseExpandedPriceLookup(state = {}) {
    if (typeof state?.heroSmsUseExpandedPriceLookup === 'boolean') {
      return state.heroSmsUseExpandedPriceLookup;
    }
    const runningInNode = (
      typeof process !== 'undefined'
      && process
      && process.versions
      && process.versions.node
    );
    return !runningInNode;
  }

  function resolveStockState(payload = {}) {
    const physicalCount = Number(payload.physicalCount);
    if (Number.isFinite(physicalCount)) {
      return { hasStockField: true, stockCount: physicalCount };
    }
    const stockCandidates = [
      payload.count,
      payload.stock,
      payload.available,
      payload.quantity,
      payload.qty,
      payload.left,
      payload.free,
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (!stockCandidates.length) {
      return { hasStockField: false, stockCount: 0 };
    }
    return { hasStockField: true, stockCount: Math.max(...stockCandidates) };
  }

  function collectPriceCandidates(payload, candidates = []) {
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectPriceCandidates(entry, candidates));
      return candidates;
    }
    if (!payload || typeof payload !== 'object') {
      return candidates;
    }
    const cost = normalizeHeroSmsPrice(payload.cost);
    if (cost !== null) {
      const stockState = resolveStockState(payload);
      if (!stockState.hasStockField || stockState.stockCount > 0) {
        candidates.push(cost);
      }
    }
    Object.entries(payload).forEach(([key, value]) => {
      const keyedPrice = normalizeHeroSmsPrice(key);
      if (keyedPrice === null) {
        return;
      }
      if (value && typeof value === 'object') {
        const stockState = resolveStockState(value);
        if (stockState.hasStockField && stockState.stockCount > 0) {
          candidates.push(keyedPrice);
        }
        return;
      }
      const numericCount = Number(value);
      if (Number.isFinite(numericCount) && numericCount > 0) {
        candidates.push(keyedPrice);
      }
    });
    Object.values(payload).forEach((value) => collectPriceCandidates(value, candidates));
    return candidates;
  }

  function collectPriceCandidatesIncludingZeroStock(payload, candidates = []) {
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectPriceCandidatesIncludingZeroStock(entry, candidates));
      return candidates;
    }
    if (!payload || typeof payload !== 'object') {
      return candidates;
    }
    const cost = normalizeHeroSmsPrice(payload.cost);
    if (cost !== null) {
      candidates.push(cost);
    }
    Object.entries(payload).forEach(([key, value]) => {
      const keyedPrice = normalizeHeroSmsPrice(key);
      if (keyedPrice === null) {
        return;
      }
      if (value && typeof value === 'object') {
        if (resolveStockState(value).hasStockField) {
          candidates.push(keyedPrice);
        }
        return;
      }
      if (Number.isFinite(Number(value))) {
        candidates.push(keyedPrice);
      }
    });
    Object.values(payload).forEach((value) => collectPriceCandidatesIncludingZeroStock(value, candidates));
    return candidates;
  }

  function buildSortedUniquePriceCandidates(values = []) {
    return Array.from(
      new Set(
        values
          .map((value) => normalizeHeroSmsPrice(value))
          .filter((value) => value !== null)
          .map((value) => Math.round(value * 10000) / 10000)
      )
    )
      .sort((left, right) => left - right)
      .slice(0, MAX_PRICE_CANDIDATES);
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
    const floor = normalizeHeroSmsPrice(minExclusivePrice);
    if (floor === null || floor <= 0) {
      return Array.isArray(prices) ? [...prices] : [];
    }
    return (Array.isArray(prices) ? prices : []).filter((value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return false;
      }
      return Math.round(numeric * 10000) / 10000 > floor;
    });
  }

  function reorderPriceCandidates(prices = [], acquirePriority = HERO_SMS_ACQUIRE_PRIORITY_COUNTRY, preferredPrice = null) {
    const hasNullTier = Array.isArray(prices)
      && prices.some((value) => value === null || value === undefined || String(value).trim() === '');
    const normalized = buildSortedUniquePriceCandidates(
      (Array.isArray(prices) ? prices : []).filter((value) => (
        !(value === null || value === undefined || String(value).trim() === '')
      ))
    );
    const ordered = acquirePriority === HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH
      ? normalized.reverse()
      : normalized;
    const preferred = Number(preferredPrice);
    if (!Number.isFinite(preferred) || preferred <= 0) {
      if (ordered.length) {
        return ordered;
      }
      return hasNullTier ? [null] : [];
    }
    const normalizedPreferred = Math.round(preferred * 10000) / 10000;
    const withoutPreferred = ordered.filter((value) => value !== normalizedPreferred);
    return [normalizedPreferred, ...withoutPreferred];
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
      const normalizedPrice = normalizeHeroSmsPrice(rawPrice);
      if (normalizedPrice === null || normalizedPrice <= 0) {
        return;
      }
      normalizedMap.set(countryKey, Math.round(normalizedPrice * 10000) / 10000);
    });
    return normalizedMap;
  }

  function formatPriceRangeText(minPriceLimit = null, maxPriceLimit = null) {
    const minPrice = normalizeHeroSmsPriceLimit(minPriceLimit);
    const maxPrice = normalizeHeroSmsPriceLimit(maxPriceLimit);
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

  function resolvePriceRange(state = {}) {
    const minPriceLimit = normalizeHeroSmsPriceLimit(state?.heroSmsMinPrice);
    const maxPriceLimit = normalizeHeroSmsPriceLimit(state?.heroSmsMaxPrice);
    return {
      minPriceLimit,
      maxPriceLimit,
      hasMinPriceLimit: minPriceLimit !== null,
      hasMaxPriceLimit: maxPriceLimit !== null,
      invalidRange: minPriceLimit !== null && maxPriceLimit !== null && minPriceLimit > maxPriceLimit,
    };
  }

  async function fetchPricePayloads(config, countryConfig, state = {}) {
    const payloads = [];
    const actions = shouldUseExpandedPriceLookup(state)
      ? ['getPricesExtended', 'getPrices']
      : ['getPrices'];
    for (const action of actions) {
      try {
        const query = {
          action,
          service: DEFAULT_SERVICE_CODE,
          country: normalizeHeroSmsCountryId(countryConfig?.id),
        };
        if (action === 'getPricesExtended') {
          query.freePrice = 'true';
        }
        payloads.push(await fetchPayload(config, query, `HeroSMS ${action}`));
      } catch (_) {
        // Price lookup is best-effort; acquisition may still probe a tier.
      }
    }
    return payloads;
  }

  async function persistPricePlanSnapshot(countryConfig, pricePlan, deps = {}) {
    if (typeof deps.setState !== 'function') {
      return;
    }
    const prices = Array.isArray(pricePlan?.prices)
      ? pricePlan.prices.filter((price) => Number.isFinite(Number(price)))
      : [];
    const userLimit = pricePlan?.userLimit === null || pricePlan?.userLimit === undefined
      ? ''
      : String(pricePlan.userLimit);
    await deps.setState({
      heroSmsLastPriceTiers: prices,
      heroSmsLastPriceCountryId: normalizeHeroSmsCountryId(countryConfig?.id, 0),
      heroSmsLastPriceCountryLabel: normalizeHeroSmsCountryLabel(countryConfig?.label, DEFAULT_COUNTRY_LABEL),
      heroSmsLastPriceUserLimit: userLimit,
      heroSmsLastPriceAt: Date.now(),
    });
  }

  async function resolvePricePlan(state = {}, countryConfig = resolveCountryConfig(state), deps = {}) {
    const config = resolveConfig(state, deps);
    for (let attempt = 1; attempt <= DEFAULT_PRICE_LOOKUP_ATTEMPTS; attempt += 1) {
      try {
        const payloads = await fetchPricePayloads(config, countryConfig, state);
        const userLimit = normalizeHeroSmsPriceLimit(state.heroSmsMaxPrice);
        const inStockCandidates = buildSortedUniquePriceCandidates(
          payloads.flatMap((payload) => collectPriceCandidates(payload, []))
        );
        const allCatalogCandidates = buildSortedUniquePriceCandidates(
          payloads.flatMap((payload) => collectPriceCandidatesIncludingZeroStock(payload, []))
        );
        const mergedCandidates = inStockCandidates.length
          ? buildSortedUniquePriceCandidates([...inStockCandidates, ...allCatalogCandidates])
          : [];
        const minCatalogPrice = allCatalogCandidates.length
          ? allCatalogCandidates[0]
          : (mergedCandidates.length ? mergedCandidates[0] : null);
        let plan = null;
        if (userLimit !== null) {
          const bounded = mergedCandidates.filter((price) => price <= userLimit);
          plan = {
            prices: bounded.length > 0 ? bounded : [userLimit],
            userLimit,
            minCatalogPrice,
            syntheticUserLimitProbe: bounded.length <= 0,
          };
        } else if (mergedCandidates.length > 0) {
          plan = {
            prices: mergedCandidates,
            userLimit: null,
            minCatalogPrice,
            syntheticUserLimitProbe: false,
          };
        } else {
          plan = {
            prices: [null],
            userLimit: null,
            minCatalogPrice: null,
            syntheticUserLimitProbe: false,
          };
        }
        await persistPricePlanSnapshot(countryConfig, plan, deps);
        if (
          Array.isArray(plan.prices)
          && plan.prices.length > 0
          && (
            plan.prices.some((price) => Number.isFinite(Number(price)) && Number(price) > 0)
            || plan.syntheticUserLimitProbe
          )
        ) {
          return plan;
        }
      } catch (_) {
        // Retry price lookup before falling back to automatic tier.
      }
    }
    const fallbackPlan = {
      prices: [null],
      userLimit: null,
      minCatalogPrice: null,
      syntheticUserLimitProbe: false,
    };
    await persistPricePlanSnapshot(countryConfig, fallbackPlan, deps);
    return fallbackPlan;
  }

  function extractWrongMaxPrice(payload) {
    if (payload && typeof payload === 'object') {
      const title = String(payload.title || '').trim();
      const minPrice = normalizeHeroSmsPrice(payload.info?.min);
      if (/^WRONG_MAX_PRICE$/i.test(title) && minPrice !== null) {
        return minPrice;
      }
    }
    const text = describePayload(payload);
    const match = text.match(/\bWRONG_MAX_PRICE:(\d+(?:\.\d+)?)\b/i);
    return match ? normalizeHeroSmsPrice(match[1]) : null;
  }

  function isNetworkFetchFailure(error) {
    return /failed to fetch|networkerror|load failed/i.test(String(error?.message || '').trim());
  }

  function isNoNumbersPayload(payload) {
    return /\bNO_NUMBERS\b/i.test(describePayload(payload));
  }

  function isTerminalError(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /\bNO_BALANCE\b|\bNOT_ENOUGH_BALANCE\b|\bBAD_KEY\b|\bINVALID_KEY\b|\bBANNED\b|\bACCOUNT_BANNED\b|\bWRONG_KEY\b/i.test(text);
  }

  function formatActionName(action = '') {
    const normalized = String(action || '').trim().toLowerCase();
    if (normalized === 'getnumber' || normalized === 'getnumberv2') {
      return '获取手机号';
    }
    if (normalized === 'getstatus' || normalized === 'getstatusv2') {
      return '查询短信状态';
    }
    if (normalized === 'setstatus') {
      return '更新订单状态';
    }
    if (normalized === 'getprices' || normalized === 'getpricesextended') {
      return '查询价格';
    }
    return action ? `${action} 请求` : '请求';
  }

  function createActionFailureError(action, reason = '') {
    const rawReason = describePayload(reason) || '未知错误';
    let normalizedReason = rawReason;
    if (/\bBAD_KEY\b|\bWRONG_KEY\b|\bINVALID_KEY\b/i.test(rawReason)) {
      normalizedReason = 'API Key 无效（BAD_KEY）';
    } else if (/\bNO_BALANCE\b|\bNOT_ENOUGH_BALANCE\b/i.test(rawReason)) {
      normalizedReason = '余额不足';
    } else if (/\bBANNED\b|\bACCOUNT_BANNED\b/i.test(rawReason)) {
      normalizedReason = '账号已被封禁';
    }
    const error = new Error(`HeroSMS ${formatActionName(action)}失败：${normalizedReason}`);
    error.localizedPhoneSmsFailure = true;
    return error;
  }

  async function fetchActivationPayload(config, countryConfig, action, options = {}) {
    const query = {
      action,
      service: DEFAULT_SERVICE_CODE,
      country: normalizeHeroSmsCountryId(countryConfig?.id),
    };
    const operator = normalizeHeroSmsOperator(config?.operator, DEFAULT_OPERATOR);
    if (operator && operator !== DEFAULT_OPERATOR) {
      query.operator = operator;
    }
    if (options.maxPrice !== null && options.maxPrice !== undefined) {
      query.maxPrice = options.maxPrice;
      if (options.fixedPrice !== false) {
        query.fixedPrice = 'true';
      }
    }
    return fetchPayload(config, query, `HeroSMS ${action}`);
  }

  async function requestActivationWithPrice(config, countryConfig, action, maxPrice, options = {}) {
    let nextMaxPrice = maxPrice;
    let retriedWithUpdatedPrice = false;
    let retriedWithoutPrice = false;
    const userLimit = normalizeHeroSmsPriceLimit(options.userLimit);
    const userMinLimit = normalizeHeroSmsPriceLimit(options.userMinLimit);
    while (true) {
      try {
        return await fetchActivationPayload(config, countryConfig, action, {
          maxPrice: nextMaxPrice,
          fixedPrice: options.fixedPrice,
        });
      } catch (error) {
        const updatedMaxPrice = extractWrongMaxPrice(error?.payload || error?.message);
        if (
          nextMaxPrice !== null
          && nextMaxPrice !== undefined
          && !retriedWithUpdatedPrice
          && updatedMaxPrice !== null
        ) {
          if (userLimit !== null && updatedMaxPrice > userLimit) {
            throw new Error(
              `HeroSMS ${formatActionName(action)}失败：价格上限过低，平台要求至少 ${updatedMaxPrice}，已超过当前配置的价格上限 ${userLimit}。`
            );
          }
          if (userMinLimit !== null && updatedMaxPrice < userMinLimit) {
            throw new Error(
              `HeroSMS ${formatActionName(action)}失败：平台要求价格 ${updatedMaxPrice} 低于当前配置的最低购买价 ${userMinLimit}。`
            );
          }
          nextMaxPrice = updatedMaxPrice;
          retriedWithUpdatedPrice = true;
          continue;
        }
        if (
          nextMaxPrice !== null
          && nextMaxPrice !== undefined
          && !retriedWithoutPrice
          && isNetworkFetchFailure(error)
        ) {
          nextMaxPrice = null;
          retriedWithoutPrice = true;
          continue;
        }
        throw error;
      }
    }
  }

  function normalizeActivation(record, fallback = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }
    const activationId = String(record.activationId ?? record.id ?? record.activation ?? '').trim();
    const phoneNumber = String(record.phoneNumber ?? record.number ?? record.phone ?? '').trim();
    if (!activationId || !phoneNumber) {
      return null;
    }
    const statusAction = String(record.statusAction || fallback.statusAction || '').trim();
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: String(record.serviceCode || fallback.serviceCode || DEFAULT_SERVICE_CODE).trim() || DEFAULT_SERVICE_CODE,
      countryId: normalizeHeroSmsCountryId(record.countryId ?? record.country ?? fallback.countryId),
      ...(record.countryLabel
        ? { countryLabel: normalizeHeroSmsCountryLabel(record.countryLabel, fallback.countryLabel) }
        : {}),
      successfulUses: Math.max(0, Math.floor(Number(record.successfulUses ?? fallback.successfulUses) || 0)),
      maxUses: Math.max(1, Math.floor(Number(record.maxUses ?? fallback.maxUses) || DEFAULT_MAX_USES)),
      ...(statusAction ? { statusAction } : {}),
      ...(record.source ? { source: String(record.source || '').trim() } : {}),
    };
  }

  function resolveCountryLabel(state = {}, countryId = DEFAULT_COUNTRY_ID) {
    const countryKey = normalizeCountryKey(countryId);
    const matched = resolveCountryCandidates(state)
      .find((entry) => normalizeCountryKey(entry.id) === countryKey);
    return matched?.label || normalizeHeroSmsCountryLabel('', countryKey ? `Country #${countryKey}` : DEFAULT_COUNTRY_LABEL);
  }

  function resolveActivationCountry(activation = {}, state = {}) {
    const normalizedActivation = normalizeActivation(activation)
      || (activation && typeof activation === 'object' ? activation : {});
    const inferred = inferCountryFromPhoneNumber(normalizedActivation.phoneNumber);
    const rawCountryId = normalizeHeroSmsCountryId(normalizedActivation.countryId, 0);
    const hasExplicitCountry = (
      rawCountryId > 0
      && !(
        normalizedActivation.manualOnly
        && rawCountryId === DEFAULT_COUNTRY_ID
        && inferred?.id
        && inferred.id !== rawCountryId
      )
    );
    const countryId = hasExplicitCountry
      ? rawCountryId
      : normalizeHeroSmsCountryId(inferred?.id, rawCountryId || DEFAULT_COUNTRY_ID);
    const matched = resolveCountryCandidates(state)
      .find((entry) => normalizeHeroSmsCountryId(entry.id, 0) === countryId);
    if (matched) {
      return matched;
    }
    return {
      id: countryId,
      label: normalizeHeroSmsCountryLabel(
        hasExplicitCountry ? normalizedActivation.countryLabel : (inferred?.label || normalizedActivation.countryLabel),
        `Country #${countryId}`
      ),
    };
  }

  function getActivationCountryKey(activation = {}) {
    return normalizeCountryKey(activation?.countryId ?? activation?.country);
  }

  function getActivationPrice(activation = {}) {
    return normalizeHeroSmsPrice(
      activation?.selectedPrice
      ?? activation?.price
      ?? activation?.maxPrice
    );
  }

  function parseActivationPayload(payload, fallback = {}) {
    const normalizedFallback = normalizeActivation(fallback) || (fallback && typeof fallback === 'object' ? fallback : {});
    const direct = normalizeActivation(payload, normalizedFallback);
    if (direct) {
      return direct;
    }
    const text = describePayload(payload);
    const accessNumberMatch = text.match(/^ACCESS_NUMBER:([^:]+):(.+)$/i);
    if (accessNumberMatch) {
      return normalizeActivation({
        activationId: String(accessNumberMatch[1] || '').trim(),
        phoneNumber: String(accessNumberMatch[2] || '').trim(),
        provider: PROVIDER_ID,
        serviceCode: normalizedFallback.serviceCode || DEFAULT_SERVICE_CODE,
        countryId: normalizedFallback.countryId || DEFAULT_COUNTRY_ID,
        successfulUses: normalizedFallback.successfulUses ?? 0,
        maxUses: normalizedFallback.maxUses ?? DEFAULT_MAX_USES,
        statusAction: normalizedFallback.statusAction,
      });
    }
    if (/^ACCESS_READY$/i.test(text) && normalizedFallback?.activationId) {
      return normalizeActivation(normalizedFallback);
    }
    return null;
  }

  function resolveActivationStatusAction(activation = {}) {
    return activation?.statusAction === 'getStatusV2' ? 'getStatusV2' : 'getStatus';
  }

  function extractVerificationCode(rawCode) {
    const trimmed = String(rawCode || '').trim();
    if (!trimmed) {
      return '';
    }
    return trimmed.match(/\b(\d{4,8})\b/)?.[1] || '';
  }

  async function setActivationStatus(state = {}, activation, status, deps = {}, actionLabel = 'HeroSMS setStatus') {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      return '';
    }
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, {
      action: 'setStatus',
      id: normalizedActivation.activationId,
      status: Math.floor(Number(status) || 0),
    }, actionLabel);
    return describePayload(payload);
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const allCountryCandidates = resolveCountryCandidates(state);
    if (!allCountryCandidates.length) {
      throw new Error('步骤 9：HeroSMS 未选择国家，请先在接码设置中至少选择 1 个国家。');
    }
    const blockedCountryIds = new Set(
      (Array.isArray(options?.blockedCountryIds) ? options.blockedCountryIds : [])
        .map((value) => normalizeHeroSmsCountryId(value, 0))
        .filter((id) => id > 0)
    );
    let countryCandidates = allCountryCandidates.filter(
      (entry) => !blockedCountryIds.has(normalizeHeroSmsCountryId(entry.id, 0))
    );
    if (!countryCandidates.length) {
      countryCandidates = allCountryCandidates;
      if (blockedCountryIds.size && typeof deps.addLog === 'function') {
        await deps.addLog('步骤 9：已选国家均达到临时收码失败跳过阈值，本轮解除跳过并重新尝试。', 'warn');
      }
    }
    const acquirePriority = normalizeHeroSmsAcquirePriority(state?.heroSmsAcquirePriority);
    const priceRange = resolvePriceRange(state);
    if (priceRange.invalidRange) {
      throw new Error(`HeroSMS 价格区间无效：最低购买价 ${priceRange.minPriceLimit} 高于价格上限 ${priceRange.maxPriceLimit}。`);
    }
    const preferredPriceTier = normalizeHeroSmsPriceLimit(state?.heroSmsPreferredPrice);
    const countryPriceFloorByCountryId = normalizePriceFloorMap(
      options?.countryPriceFloorByCountryId,
      (value) => String(normalizeHeroSmsCountryId(value, 0))
    );
    const requestActions = ['getNumber', 'getNumberV2'];
    const maxAcquireRounds = Math.max(2, normalizeActivationRetryRounds(state?.heroSmsActivationRetryRounds));
    const retryDelayMs = normalizeActivationRetryDelayMs(state?.heroSmsActivationRetryDelayMs);
    let finalNoNumbersByCountry = [];
    let finalLastError = null;
    let finalLastFailureText = '';

    for (let round = 1; round <= maxAcquireRounds; round += 1) {
      if (maxAcquireRounds > 1 && typeof deps.addLog === 'function') {
        await deps.addLog(`步骤 9：HeroSMS 正在获取手机号（第 ${round}/${maxAcquireRounds} 轮）...`, 'info');
      }
      const countryAttempts = countryCandidates.map((countryConfig, index) => ({
        index,
        countryConfig,
        pricePlan: null,
        orderingPrice: Number.POSITIVE_INFINITY,
      }));

      if (
        acquirePriority === HERO_SMS_ACQUIRE_PRIORITY_PRICE
        || acquirePriority === HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH
      ) {
        for (const attempt of countryAttempts) {
          const pricePlan = await resolvePricePlan(state, attempt.countryConfig, deps);
          const orderedPrices = reorderPriceCandidates(pricePlan?.prices, acquirePriority, preferredPriceTier);
          const rangeFilteredForRanking = filterPriceCandidatesWithinRange(
            orderedPrices,
            priceRange.minPriceLimit,
            priceRange.maxPriceLimit
          );
          const rankingPrices = rangeFilteredForRanking.length
            ? rangeFilteredForRanking
            : ((priceRange.hasMinPriceLimit || priceRange.hasMaxPriceLimit) ? [] : orderedPrices);
          const numericPrices = rankingPrices
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
          const candidateOrderingPrice = numericPrices.length ? numericPrices[0] : null;
          const cappedByUserLimit = (
            pricePlan?.userLimit !== null
            && pricePlan?.userLimit !== undefined
            && pricePlan?.minCatalogPrice !== null
            && pricePlan?.minCatalogPrice !== undefined
            && Number(pricePlan.minCatalogPrice) > Number(pricePlan.userLimit)
          );
          attempt.pricePlan = pricePlan;
          attempt.orderingPrice = cappedByUserLimit
            ? Number.POSITIVE_INFINITY
            : (candidateOrderingPrice !== null ? candidateOrderingPrice : Number.POSITIVE_INFINITY);
        }
      }

      if (
        (acquirePriority === HERO_SMS_ACQUIRE_PRIORITY_PRICE || acquirePriority === HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH)
        && countryAttempts.length > 1
      ) {
        countryAttempts.sort((left, right) => {
          if (left.orderingPrice !== right.orderingPrice) {
            return acquirePriority === HERO_SMS_ACQUIRE_PRIORITY_PRICE_HIGH
              ? (right.orderingPrice - left.orderingPrice)
              : (left.orderingPrice - right.orderingPrice);
          }
          return left.index - right.index;
        });
      }

      const noNumbersByCountry = [];
      const retryableNoNumberCountries = [];
      let lastError = null;
      let lastFailureText = '';

      for (const attempt of countryAttempts) {
        const countryConfig = attempt.countryConfig;
        const countryIdKey = String(normalizeHeroSmsCountryId(countryConfig?.id, 0));
        const countryPriceFloor = countryPriceFloorByCountryId.get(countryIdKey) ?? null;
        const buildFallbackActivation = (requestAction) => ({
          countryId: countryConfig.id,
          ...(requestAction === 'getNumberV2' ? { statusAction: 'getStatusV2' } : {}),
        });
        const pricePlan = attempt.pricePlan || await resolvePricePlan(state, countryConfig, deps);
        let noNumbersObservedInCountry = false;
        const orderedPrices = reorderPriceCandidates(pricePlan.prices, acquirePriority, preferredPriceTier);
        const rangeFilteredPrices = filterPriceCandidatesWithinRange(
          orderedPrices,
          priceRange.minPriceLimit,
          priceRange.maxPriceLimit
        );
        const candidatePrices = rangeFilteredPrices.length
          ? rangeFilteredPrices
          : ((priceRange.hasMinPriceLimit || priceRange.hasMaxPriceLimit) ? [] : orderedPrices);
        const floorFilteredPrices = filterPriceCandidatesAboveFloor(candidatePrices, countryPriceFloor);
        const hasCountryPriceFloor = (
          countryPriceFloor !== null
          && Number.isFinite(Number(countryPriceFloor))
          && Number(countryPriceFloor) > 0
        );
        const hasAlternativeCountries = countryAttempts.some((entry) => (
          String(normalizeHeroSmsCountryId(entry?.countryConfig?.id, 0))
          !== String(normalizeHeroSmsCountryId(countryConfig?.id, 0))
        ));
        const pricesToTry = hasCountryPriceFloor
          ? (floorFilteredPrices.length ? floorFilteredPrices : (hasAlternativeCountries ? [] : candidatePrices.slice(0, 1)))
          : (floorFilteredPrices.length ? floorFilteredPrices : candidatePrices);

        if (typeof deps.addLog === 'function') {
          const rawTierText = Array.isArray(pricePlan?.prices) && pricePlan.prices.length
            ? pricePlan.prices.map((value) => (value === null || value === undefined ? '自动' : String(value))).join(', ')
            : '无';
          await deps.addLog(
            `步骤 9：HeroSMS ${countryConfig.label} 价格方案：档位=[${rawTierText}]，用户上限=${pricePlan?.userLimit ?? '未设置'}，目录最低价=${pricePlan?.minCatalogPrice ?? '未知'}。`,
            'info'
          );
        }

        if (!pricesToTry.length) {
          if (priceRange.hasMinPriceLimit && !rangeFilteredPrices.length) {
            noNumbersByCountry.push(`${countryConfig.label}: 价格区间 ${formatPriceRangeText(priceRange.minPriceLimit, priceRange.maxPriceLimit)} 内暂无可用号码`);
            continue;
          }
          if (
            countryPriceFloor !== null
            && Array.isArray(pricePlan.prices)
            && pricePlan.prices.length > 0
          ) {
            noNumbersByCountry.push(`${countryConfig.label}: 当前回退尝试没有高于 ${countryPriceFloor} 的价格档位`);
            continue;
          }
          if (
            pricePlan.userLimit !== null
            && pricePlan.minCatalogPrice !== null
            && pricePlan.minCatalogPrice > pricePlan.userLimit
          ) {
            noNumbersByCountry.push(`${countryConfig.label}: 价格上限 ${pricePlan.userLimit} 内暂无可用号码；平台最低价=${pricePlan.minCatalogPrice}`);
          } else {
            noNumbersByCountry.push(`${countryConfig.label}: ${lastFailureText || 'NO_NUMBERS'}`);
            retryableNoNumberCountries.push(countryConfig.label);
          }
          continue;
        }

        for (const maxPrice of pricesToTry) {
          for (const requestAction of requestActions) {
            try {
              const fixedPrice = !Boolean(pricePlan.syntheticUserLimitProbe);
              if (typeof deps.addLog === 'function') {
                await deps.addLog(
                  `步骤 9：HeroSMS ${countryConfig.label} 正在尝试${formatActionName(requestAction)}，价格档位 ${maxPrice === null || maxPrice === undefined ? '自动' : maxPrice}。`,
                  'info'
                );
              }
              const payload = await requestActivationWithPrice(config, countryConfig, requestAction, maxPrice, {
                userLimit: pricePlan.userLimit,
                userMinLimit: priceRange.minPriceLimit,
                fixedPrice,
              });
              const activation = parseActivationPayload(payload, buildFallbackActivation(requestAction));
              if (activation) {
                return {
                  ...activation,
                  countryId: normalizeHeroSmsCountryId(countryConfig.id),
                  ...(Number.isFinite(Number(maxPrice)) && Number(maxPrice) > 0
                    ? { selectedPrice: Math.round(Number(maxPrice) * 10000) / 10000 }
                    : {}),
                };
              }
              const payloadText = describePayload(payload);
              if (isNoNumbersPayload(payload)) {
                noNumbersObservedInCountry = true;
                lastFailureText = payloadText || lastFailureText;
                continue;
              }
              if (isTerminalError(payload)) {
                throw createActionFailureError(requestAction, payloadText || 'empty response');
              }
              lastFailureText = payloadText || lastFailureText;
              lastError = createActionFailureError(requestAction, payloadText || 'empty response');
            } catch (error) {
              if (error?.localizedPhoneSmsFailure) {
                throw error;
              }
              const payloadOrMessage = error?.payload || error?.message;
              if (isTerminalError(payloadOrMessage)) {
                throw createActionFailureError(requestAction, payloadOrMessage || 'empty response');
              }
              if (isNoNumbersPayload(payloadOrMessage)) {
                noNumbersObservedInCountry = true;
                lastFailureText = describePayload(payloadOrMessage) || lastFailureText;
                continue;
              }
              lastFailureText = describePayload(payloadOrMessage) || lastFailureText;
              lastError = error;
            }
          }
        }

        if (noNumbersObservedInCountry) {
          const tiersTriedText = pricesToTry
            .map((value) => (value === null || value === undefined ? '自动' : String(value)))
            .join(', ');
          noNumbersByCountry.push(
            `${countryConfig.label}: ${lastFailureText || 'NO_NUMBERS'}${tiersTriedText ? `（已尝试档位：${tiersTriedText}）` : ''}`
          );
          retryableNoNumberCountries.push(countryConfig.label);
        }
      }

      finalNoNumbersByCountry = noNumbersByCountry;
      finalLastError = lastError;
      finalLastFailureText = lastFailureText;
      if (
        noNumbersByCountry.length
        && round < maxAcquireRounds
        && retryableNoNumberCountries.length > 0
      ) {
        if (typeof deps.addLog === 'function') {
          await deps.addLog(
            `步骤 9：HeroSMS 暂无可用号码（第 ${round}/${maxAcquireRounds} 轮）；${Math.ceil(retryDelayMs / 1000)} 秒后重试。国家：${retryableNoNumberCountries.join(', ')}。`,
            'warn'
          );
        }
        await deps.sleepWithStop?.(retryDelayMs);
        continue;
      }
      break;
    }

    if (finalNoNumbersByCountry.length) {
      throw new Error(`HeroSMS 已尝试 ${countryCandidates.length} 个候选国家，均无可用号码：${finalNoNumbersByCountry.join(' | ')}。`);
    }
    if (finalLastError) {
      throw finalLastError;
    }
    throw new Error(`HeroSMS 获取手机号失败，最后状态：${finalLastFailureText || '未知'}。`);
  }

  async function reuseActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      throw new Error('缺少可复用的 HeroSMS 手机号订单。');
    }
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, {
      action: 'reactivate',
      id: normalizedActivation.activationId,
    }, 'HeroSMS reactivate');
    const nextActivation = parseActivationPayload(payload, normalizedActivation);
    if (!nextActivation) {
      throw new Error(`HeroSMS 复用手机号失败：${describePayload(payload) || '空响应'}`);
    }
    return nextActivation;
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      throw new Error('缺少手机号接码订单。');
    }
    const config = resolveConfig(state, deps);
    const statusAction = resolveActivationStatusAction(normalizedActivation);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_POLL_TIMEOUT_MS);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_POLL_INTERVAL_MS);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let lastResponse = '';
    let pollCount = 0;
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
      const payload = await fetchPayload(config, {
        action: statusAction,
        id: normalizedActivation.activationId,
      }, `HeroSMS ${statusAction}`);
      const text = describePayload(payload);
      lastResponse = text;
      pollCount += 1;
      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: text,
          timeoutMs,
        });
      }
      const v2Code = (
        payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && (
          extractVerificationCode(payload.sms?.code)
          || extractVerificationCode(payload.call?.code)
        )
      );
      if (v2Code) {
        return v2Code;
      }
      const okMatch = text.match(/^STATUS_OK:(.+)$/i);
      if (okMatch) {
        const code = extractVerificationCode(okMatch[1] || '');
        if (code) {
          return code;
        }
        await emitWaitingForCode(text || 'STATUS_OK');
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }
      if (/^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(text)) {
        await emitWaitingForCode(text);
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }
      if (statusAction === 'getStatusV2' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
        await emitWaitingForCode(text || 'PENDING');
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }
      if (/^STATUS_CANCEL$/i.test(text)) {
        throw new Error('HeroSMS 订单在短信到达前已被取消。');
      }
      throw createActionFailureError(statusAction, text || 'empty response');
    }
    throw new Error(`${PHONE_CODE_TIMEOUT_ERROR_PREFIX}等待手机验证码超时。${lastResponse ? ` HeroSMS 最后状态：${lastResponse}` : ''}`);
  }

  async function finishActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 6, deps, 'HeroSMS setStatus(6)');
  }

  async function cancelActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 8, deps, 'HeroSMS setStatus(8)');
  }

  async function banActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 8, deps, 'HeroSMS setStatus(8)');
  }

  async function requestAdditionalSms(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 3, deps, 'HeroSMS setStatus(3)');
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
      currentTicketId: String(activation?.activationId || ''),
      nextActivation: null,
    };
  }

  function isWaitingStatusText(text) {
    return /^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(String(text || '').trim());
  }

  function isReadyForFreshSmsText(text) {
    return /^STATUS_WAIT_CODE(?::.+)?$/i.test(String(text || '').trim());
  }

  async function prepareActivationForReuse(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation);
    if (!normalizedActivation) {
      return {
        ok: false,
        reason: 'missing_activation',
        message: '已保存的免费复用手机号记录无效。',
      };
    }
    const config = resolveConfig(state, deps);
    const statusAction = resolveActivationStatusAction(normalizedActivation);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 2000);
    const maxRounds = Math.max(1, Math.floor(Number(options.maxRounds) || 10));
    const start = Date.now();
    let lastStatus = '';
    let prepareRound = 0;
    while (Date.now() - start < timeoutMs && prepareRound < maxRounds) {
      deps.throwIfStopped?.();
      prepareRound += 1;
      try {
        await requestAdditionalSms(state, normalizedActivation, deps);
      } catch (error) {
        return {
          ok: false,
          reason: 'set_status_failed',
          message: error.message || 'HeroSMS 更新订单状态失败。',
          lastStatus,
          prepareRound,
        };
      }
      if (typeof deps.addLog === 'function') {
        await deps.addLog(
          `步骤 9：自动白嫖复用已刷新 ${normalizedActivation.phoneNumber}，${Math.ceil(intervalMs / 1000)} 秒后检查等待状态（${prepareRound}/${maxRounds}）。`,
          'info'
        );
      }
      await deps.sleepWithStop?.(intervalMs);
      try {
        const payload = await fetchPayload(config, {
          action: statusAction,
          id: normalizedActivation.activationId,
        }, `HeroSMS 自动复用${statusAction}`);
        const statusText = describePayload(payload);
        lastStatus = statusText;
        if (typeof deps.addLog === 'function') {
          await deps.addLog(
            `步骤 9：自动白嫖复用号码 ${normalizedActivation.phoneNumber} 状态：${statusText || '空响应'}（${prepareRound}/${maxRounds}）。`,
            'info'
          );
        }
        const v2Waiting = statusAction === 'getStatusV2'
          && payload
          && typeof payload === 'object'
          && !Array.isArray(payload)
          && !payload.sms?.code
          && !payload.call?.code;
        if (isReadyForFreshSmsText(statusText) || isWaitingStatusText(statusText) || v2Waiting) {
          return {
            ok: true,
            activation: normalizedActivation,
          };
        }
        if (/^STATUS_OK:/i.test(statusText)) {
          if (typeof deps.addLog === 'function') {
            await deps.addLog('步骤 9：自动白嫖复用仍看到旧验证码，将再次刷新等待短信状态。', 'warn');
          }
          continue;
        }
        if (/^STATUS_CANCEL$/i.test(statusText)) {
          return {
            ok: false,
            reason: 'activation_cancelled',
            message: 'HeroSMS 订单在自动白嫖复用前已被取消。',
            lastStatus,
            prepareRound,
          };
        }
      } catch (error) {
        return {
          ok: false,
          reason: 'get_status_failed',
          message: error.message || 'HeroSMS 查询短信状态失败。',
          lastStatus,
          prepareRound,
        };
      }
    }
    return {
      ok: false,
      reason: 'prepare_timeout',
      message: `等待已保存手机号进入短信等待状态超时。最后状态：${lastStatus || '未知'}。`,
      lastStatus,
      prepareRound,
    };
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      fetchImpl: deps.fetchImpl,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
      addLog: deps.addLog,
      setState: deps.setState,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
    const capabilities = Object.freeze({
      supportsReusableActivation: true,
      supportsAutomaticFreeReuse: true,
      supportsFreeReusePreservation: true,
      supportsPageResend: true,
      supportsPageResendProbe: true,
      requiresCountrySelection: true,
    });
    return {
      id: PROVIDER_ID,
      label: 'HeroSMS',
      capabilities,
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      normalizeCountryId: normalizeHeroSmsCountryId,
      normalizeCountryLabel: normalizeHeroSmsCountryLabel,
      normalizeCountryFallback: normalizeHeroSmsCountryFallback,
      normalizeCountryKey,
      normalizeMaxPrice: normalizeHeroSmsMaxPrice,
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
      prepareActivationForReuse: (state, activation, options) => prepareActivationForReuse(state, activation, options, providerDeps),
      canPersistReusableActivation: () => true,
      canPreserveActivationForFreeReuse: (_state, activation) => {
        const normalizedActivation = normalizeActivation(activation);
        return Boolean(
          normalizedActivation
          && activation
          && typeof activation === 'object'
          && activation.phoneCodeReceived
        );
      },
      shouldUsePageResend: () => true,
      shouldProbePageResend: () => true,
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      fetchPrices: (state, countryConfig) => fetchPrices(state, countryConfig, providerDeps),
      resolvePricePlan: (state, countryConfig) => resolvePricePlan(state, countryConfig, providerDeps),
      resolvePriceRange,
      formatPriceRangeText,
      describePayload,
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
    normalizeHeroSmsCountryFallback,
    normalizeHeroSmsCountryId,
    normalizeHeroSmsCountryLabel,
    normalizeCountryKey,
    normalizeHeroSmsMaxPrice,
    normalizeHeroSmsOperator,
    normalizeActivation,
    resolveActivationCountry,
  };
});
