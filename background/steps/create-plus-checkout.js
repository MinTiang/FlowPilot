(function attachBackgroundPlusCheckoutCreate(root, factory) {
  root.MultiPageBackgroundPlusCheckoutCreate = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPlusCheckoutCreateModule() {
  const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
  const PAYPAL_SOURCE = 'paypal-flow';
  const PLUS_CHECKOUT_ENTRY_URL = 'https://chatgpt.com/';
  const PLUS_CHECKOUT_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/plus-checkout.js'];
  const PAYPAL_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/paypal-flow.js'];
  const PLUS_PAYMENT_METHOD_PAYPAL = 'paypal';
  const PLUS_PAYMENT_METHOD_PAYPAL_HOSTED = 'paypal-hosted';
  const PLUS_PAYMENT_METHOD_GOPAY = 'gopay';
  const PLUS_PAYMENT_METHOD_GPC_HELPER = 'gpc-helper';
  const DEFAULT_GPC_HELPER_API_URL = 'https://gpc.qlhazycoder.top';
  const GPC_HELPER_PHONE_MODE_AUTO = 'auto';
  const GPC_HELPER_PHONE_MODE_MANUAL = 'manual';
  const HOSTED_CHECKOUT_ADDRESS_ENDPOINT = 'https://www.meiguodizhi.com/api/v1/dz';
  const HOSTED_CHECKOUT_SUCCESS_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com|chat\.openai\.com)\/(?:backend-api\/)?payments\/success(?:[/?#]|$)/i;
  const HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS = 120000;
  const HOSTED_CHECKOUT_PAYPAL_TIMEOUT_MS = 10 * 60 * 1000;
  const HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS = 12;
  const HOSTED_CHECKOUT_VERIFICATION_POLL_INTERVAL_MS = 5000;
  const HOSTED_CHECKOUT_DEFAULT_PHONE = '1234567890';

  function createPlusCheckoutCreateExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      chrome,
      completeNodeFromBackground,
      createAutomationTab = null,
      ensureContentScriptReadyOnTabUntilStopped,
      fetch: fetchImpl = null,
      getState = null,
      registerTab,
      sendTabMessageUntilStopped,
      setState,
      sleepWithStop,
      waitForTabCompleteUntilStopped,
      waitForTabUrlMatchUntilStopped = null,
      throwIfStopped = () => {},
    } = deps;

    function addLog(message, level = 'info', options = {}) {
      return rawAddLog(message, level, {
        step: 6,
        stepKey: 'plus-checkout-create',
        ...(options && typeof options === 'object' ? options : {}),
      });
    }

    function normalizePlusPaymentMethod(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizePlusPaymentMethod) {
        return rootScope.GoPayUtils.normalizePlusPaymentMethod(value);
      }
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized === PLUS_PAYMENT_METHOD_PAYPAL_HOSTED || normalized === 'paypal_direct' || normalized === 'paypal-direct') {
        return PLUS_PAYMENT_METHOD_PAYPAL_HOSTED;
      }
      if (normalized === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        return PLUS_PAYMENT_METHOD_GPC_HELPER;
      }
      return normalized === PLUS_PAYMENT_METHOD_GOPAY ? PLUS_PAYMENT_METHOD_GOPAY : PLUS_PAYMENT_METHOD_PAYPAL;
    }

    function getCheckoutModeLabel(state = {}) {
      const paymentMethod = normalizePlusPaymentMethod(state?.plusPaymentMethod);
      if (paymentMethod === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        return 'GPC 订阅页';
      }
      if (paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL_HOSTED) {
        return 'PayPal 无卡直绑';
      }
      return paymentMethod === PLUS_PAYMENT_METHOD_GOPAY ? 'GoPay 订阅页' : 'Plus Checkout';
    }

    function getPlusPaymentMethodLabel(method = PLUS_PAYMENT_METHOD_PAYPAL) {
      const paymentMethod = normalizePlusPaymentMethod(method);
      if (paymentMethod === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        return 'GPC';
      }
      if (paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL_HOSTED) {
        return 'PayPal 无卡直绑';
      }
      return paymentMethod === PLUS_PAYMENT_METHOD_GOPAY ? 'GoPay' : 'PayPal';
    }

    async function openFreshChatGptTabForCheckoutCreate() {
      const tab = typeof createAutomationTab === 'function'
        ? await createAutomationTab({ url: PLUS_CHECKOUT_ENTRY_URL, active: true })
        : await chrome.tabs.create({ url: PLUS_CHECKOUT_ENTRY_URL, active: true });
      const tabId = Number(tab?.id);
      if (!Number.isInteger(tabId)) {
        throw new Error('步骤 6：打开 ChatGPT 页面失败，无法创建订阅页。');
      }
      if (typeof registerTab === 'function') {
        await registerTab(PLUS_CHECKOUT_SOURCE, tabId);
      }
      return tabId;
    }

    function isPayPalUrl(url = '') {
      return /paypal\./i.test(String(url || ''));
    }

    function isHostedCheckoutSuccessUrl(url = '') {
      return HOSTED_CHECKOUT_SUCCESS_URL_PATTERN.test(String(url || ''));
    }

    function isHostedOpenAiCheckoutUrl(url = '') {
      return /^https:\/\/(?:pay\.openai\.com|checkout\.stripe\.com)\/c\/pay(?:\/|$)/i.test(String(url || ''));
    }

    async function waitForUrlMatch(tabId, matcher, timeoutMs = 30000, retryDelayMs = 500) {
      const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 30000);
      while (Date.now() < deadline) {
        throwIfStopped();
        const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
        if (!tab) {
          return null;
        }
        if (matcher(tab.url || '', tab)) {
          return tab;
        }
        await sleepWithStop(retryDelayMs);
      }
      return null;
    }

    async function getHostedCheckoutRuntimeConfig(state = {}) {
      const latestState = typeof getState === 'function' ? await getState().catch(() => ({})) : {};
      return {
        verificationUrl: String(
          state?.hostedCheckoutVerificationUrl
          || latestState?.hostedCheckoutVerificationUrl
          || ''
        ).trim(),
        phone: String(
          state?.hostedCheckoutPhoneNumber
          || latestState?.hostedCheckoutPhoneNumber
          || HOSTED_CHECKOUT_DEFAULT_PHONE
        ).trim(),
        oauthDelaySeconds: normalizeHostedCheckoutDelaySeconds(
          state?.plusHostedCheckoutOauthDelaySeconds
          ?? latestState?.plusHostedCheckoutOauthDelaySeconds
        ),
      };
    }

    function normalizeHostedCheckoutDelaySeconds(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 3;
      }
      return Math.min(120, Math.max(0, Math.floor(numeric)));
    }

    async function fetchHostedCheckoutAddress() {
      const { response, data } = await fetchJsonWithTimeout(HOSTED_CHECKOUT_ADDRESS_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: '/', method: 'address' }),
      }, 30000);
      if (!response?.ok) {
        throw new Error(`获取无卡直绑地址失败（HTTP ${response?.status || 0}）。`);
      }
      const address = data?.address || data || {};
      return {
        street: String(address.Address || address.street || '123 Main St').trim(),
        city: String(address.City || address.city || 'New York').trim(),
        state: String(address.State_Full || address.State || address.state || 'New York').trim(),
        zip: String(address.Zip_Code || address.zip || '10001').trim().slice(0, 5) || '10001',
      };
    }

    function buildRandomHostedEmail() {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let localPart = '';
      for (let index = 0; index < 16; index += 1) {
        localPart += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return `${localPart}@gmail.com`;
    }

    function buildRandomHostedPassword() {
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^';
      let value = 'Aa1!';
      while (value.length < 14) {
        value += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return value;
    }

    function buildHostedVisaCard() {
      const digits = [4, 1, 4, 7];
      while (digits.length < 15) {
        digits.push(Math.floor(Math.random() * 10));
      }
      const reversed = digits.slice().reverse();
      let sum = 0;
      for (let index = 0; index < reversed.length; index += 1) {
        let digit = reversed[index];
        if (index % 2 === 0) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
      }
      digits.push((10 - (sum % 10)) % 10);
      const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
      const year = (new Date().getFullYear() % 100) + 3;
      return {
        number: digits.join(''),
        expiry: `${month} / ${year}`,
        cvv: String(Math.floor(100 + Math.random() * 900)),
      };
    }

    function buildHostedGuestProfile(address = {}, config = {}) {
      const card = buildHostedVisaCard();
      return {
        email: buildRandomHostedEmail(),
        password: buildRandomHostedPassword(),
        phone: String(config?.phone || HOSTED_CHECKOUT_DEFAULT_PHONE).trim(),
        firstName: 'James',
        lastName: 'Smith',
        cardNumber: card.number,
        cardExpiry: card.expiry,
        cardCvv: card.cvv,
        address,
      };
    }

    function extractHostedVerificationCode(payload = '') {
      const candidates = [payload?.data, payload?.code, payload?.text, payload?.message, payload];
      for (const candidate of candidates) {
        const text = typeof candidate === 'object' ? JSON.stringify(candidate) : String(candidate || '');
        const match = text.match(/\d{6}/);
        if (match) {
          return match[0];
        }
      }
      return '';
    }

    async function fetchHostedVerificationCode(verificationUrl = '') {
      const url = String(verificationUrl || '').trim();
      if (!url) {
        throw new Error('未配置 PayPal 无卡直绑验证码接口。');
      }
      const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (typeof fetcher !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法获取无卡直绑验证码。');
      }
      const separator = url.includes('?') ? '&' : '?';
      const response = await fetcher(`${url}${separator}t=${Date.now()}`, {
        method: 'GET',
        headers: { Accept: 'application/json,text/plain,*/*' },
      });
      const text = await response.text().catch(() => '');
      let payload = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = text;
      }
      const code = extractHostedVerificationCode(payload);
      if (!code) {
        throw new Error('验证码接口暂未返回有效 6 位验证码。');
      }
      return code;
    }

    async function pollHostedVerificationCode(verificationUrl = '') {
      let lastError = null;
      for (let attempt = 1; attempt <= HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS; attempt += 1) {
        throwIfStopped();
        try {
          const code = await fetchHostedVerificationCode(verificationUrl);
          await addLog(`步骤 6：已获取无卡直绑验证码（${attempt}/${HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS}）。`, 'info');
          return code;
        } catch (error) {
          lastError = error;
          await addLog(`步骤 6：无卡直绑验证码暂不可用（${attempt}/${HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS}）：${error?.message || error}`, 'warn');
          if (attempt < HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS) {
            await sleepWithStop(HOSTED_CHECKOUT_VERIFICATION_POLL_INTERVAL_MS);
          }
        }
      }
      throw lastError || new Error('无卡直绑验证码轮询失败。');
    }

    async function runHostedOpenAiCheckout(tabId, profile, config) {
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待 OpenAI hosted checkout 脚本就绪...',
      });
      const firstResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP',
        source: 'background',
        payload: { address: profile.address },
      });
      if (firstResult?.error) {
        throw new Error(firstResult.error);
      }

      const deadline = Date.now() + HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS;
      let verificationSubmitted = false;
      while (Date.now() < deadline) {
        throwIfStopped();
        const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
        if (!tab) {
          throw new Error('步骤 6：无卡直绑 checkout 标签页已关闭。');
        }
        const currentUrl = String(tab.url || '').trim();
        if (isPayPalUrl(currentUrl) || isHostedCheckoutSuccessUrl(currentUrl)) {
          return currentUrl;
        }
        await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
          inject: PLUS_CHECKOUT_INJECT_FILES,
          injectSource: PLUS_CHECKOUT_SOURCE,
        });
        const pageState = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
          type: 'PLUS_CHECKOUT_GET_STATE',
          source: 'background',
          payload: {},
        });
        if (pageState?.error) {
          throw new Error(pageState.error);
        }
        if (pageState?.hostedVerificationVisible && !verificationSubmitted) {
          const verificationCode = await pollHostedVerificationCode(config.verificationUrl);
          const verifyResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
            type: 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP',
            source: 'background',
            payload: { verificationCode },
          });
          if (verifyResult?.error) {
            throw new Error(verifyResult.error);
          }
          verificationSubmitted = true;
        }
        await sleepWithStop(500);
      }
      throw new Error('步骤 6：OpenAI hosted checkout 长时间未跳转到 PayPal 或支付成功页。');
    }

    async function getHostedPayPalState(tabId) {
      await waitForTabCompleteUntilStopped(tabId);
      await ensureContentScriptReadyOnTabUntilStopped(PAYPAL_SOURCE, tabId, {
        inject: PAYPAL_INJECT_FILES,
        injectSource: PAYPAL_SOURCE,
        logMessage: '步骤 6：正在等待 PayPal 无卡直绑页面脚本就绪...',
      });
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_HOSTED_GET_STATE',
        source: 'background',
        payload: {},
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function runHostedPayPalStep(tabId, payload = {}) {
      await waitForTabCompleteUntilStopped(tabId);
      await ensureContentScriptReadyOnTabUntilStopped(PAYPAL_SOURCE, tabId, {
        inject: PAYPAL_INJECT_FILES,
        injectSource: PAYPAL_SOURCE,
        logMessage: '步骤 6：正在等待 PayPal 无卡直绑页面脚本就绪...',
      });
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP',
        source: 'background',
        payload,
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function runHostedPayPalCheckout(tabId, profile, config) {
      const deadline = Date.now() + HOSTED_CHECKOUT_PAYPAL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        throwIfStopped();
        const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
        if (!tab) {
          throw new Error('步骤 6：PayPal 无卡直绑标签页已关闭。');
        }
        const currentUrl = String(tab.url || '').trim();
        if (isHostedCheckoutSuccessUrl(currentUrl)) {
          await addLog('步骤 6：PayPal 无卡直绑已回到 ChatGPT 支付成功页。', 'ok');
          return currentUrl;
        }
        if (!isPayPalUrl(currentUrl)) {
          await addLog(`步骤 6：无卡直绑已离开 PayPal（${currentUrl || '空 URL'}），继续等待支付成功页。`, 'info');
          await sleepWithStop(1000);
          continue;
        }

        const pageState = await getHostedPayPalState(tabId);
        if (pageState.hostedStage === 'verification' && pageState.verificationInputsVisible) {
          const verificationCode = await pollHostedVerificationCode(config.verificationUrl);
          await runHostedPayPalStep(tabId, { verificationCode });
          await sleepWithStop(1000);
          continue;
        }
        if (pageState.hostedStage === 'pay_login') {
          await addLog('步骤 6：正在填写 PayPal 无卡直绑登录邮箱。', 'info');
          await runHostedPayPalStep(tabId, { email: profile.email });
          await sleepWithStop(1000);
          continue;
        }
        if (pageState.hostedStage === 'guest_checkout') {
          await addLog('步骤 6：正在填写 PayPal 无卡直绑卡支付资料。', 'info');
          await runHostedPayPalStep(tabId, {
            ...profile,
            phone: config.phone || profile.phone,
          });
          await sleepWithStop(1500);
          continue;
        }
        if (pageState.hostedStage === 'review_consent') {
          await addLog('步骤 6：正在确认 PayPal 无卡直绑账单复核页。', 'info');
          await runHostedPayPalStep(tabId, {});
          await sleepWithStop(1000);
          continue;
        }
        if (pageState.hostedStage === 'approval') {
          throw new Error('步骤 6：无卡直绑流程进入普通 PayPal 授权页，请检查支付方式是否选择正确。');
        }
        await sleepWithStop(1000);
      }
      throw new Error('步骤 6：PayPal 无卡直绑自动化超时，未等到支付成功页。');
    }

    async function waitHostedSuccessDelayAndComplete(tabId, state = {}, successUrl = '') {
      const config = await getHostedCheckoutRuntimeConfig(state);
      if (config.oauthDelaySeconds > 0) {
        await addLog(`步骤 6：支付成功后等待 ${config.oauthDelaySeconds} 秒，再继续账号接入。`, 'info');
        await sleepWithStop(config.oauthDelaySeconds * 1000);
      }
      await completeNodeFromBackground('plus-checkout-create', {
        plusReturnUrl: successUrl,
        plusHostedCheckoutCompleted: true,
        plusHostedCheckoutOauthDelaySeconds: config.oauthDelaySeconds,
      });
    }

    function resolveCheckoutTargetUrl(result = {}, paymentMethod = PLUS_PAYMENT_METHOD_PAYPAL) {
      if (paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL_HOSTED) {
        return String(
          result?.preferredCheckoutUrl
          || result?.hostedCheckoutUrl
          || result?.checkoutUrl
          || ''
        ).trim();
      }
      return String(result?.checkoutUrl || '').trim();
    }

    async function executeHostedCheckoutCreate(tabId, state = {}, result = {}) {
      const targetCheckoutUrl = resolveCheckoutTargetUrl(result, PLUS_PAYMENT_METHOD_PAYPAL_HOSTED);
      if (!targetCheckoutUrl) {
        throw new Error('步骤 6：PayPal 无卡直绑未返回可用的订阅链接。');
      }

      await addLog('步骤 6：PayPal 无卡直绑链接已创建，正在打开 hosted checkout 页面...', 'ok');
      await chrome.tabs.update(tabId, { url: targetCheckoutUrl, active: true });
      await waitForTabCompleteUntilStopped(tabId);

      const landedTab = await waitForUrlMatch(
        tabId,
        (url) => isHostedOpenAiCheckoutUrl(url) || isPayPalUrl(url) || isHostedCheckoutSuccessUrl(url),
        HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS,
        500
      );
      const landedUrl = String(landedTab?.url || targetCheckoutUrl || '').trim();

      await setState({
        plusCheckoutTabId: tabId,
        plusCheckoutUrl: landedUrl,
        plusCheckoutCountry: result.country || 'US',
        plusCheckoutCurrency: result.currency || 'USD',
        plusCheckoutSource: PLUS_PAYMENT_METHOD_PAYPAL_HOSTED,
        plusReturnUrl: '',
      });

      await addLog(`步骤 6：PayPal 无卡直绑页面已就绪（${result.country || 'US'} ${result.currency || 'USD'}），开始自动完成直绑支付链路。`, 'info');

      if (isHostedCheckoutSuccessUrl(landedUrl)) {
        await waitHostedSuccessDelayAndComplete(tabId, state, landedUrl);
        return;
      }

      const config = await getHostedCheckoutRuntimeConfig(state);
      const address = await fetchHostedCheckoutAddress();
      const guestProfile = buildHostedGuestProfile(address, config);
      let transitionUrl = landedUrl;

      if (isHostedOpenAiCheckoutUrl(transitionUrl)) {
        transitionUrl = await runHostedOpenAiCheckout(tabId, guestProfile, config);
      }

      if (isHostedCheckoutSuccessUrl(transitionUrl)) {
        await waitHostedSuccessDelayAndComplete(tabId, state, transitionUrl);
        return;
      }

      if (!isPayPalUrl(transitionUrl)) {
        const transitionTab = await waitForUrlMatch(
          tabId,
          (url) => isPayPalUrl(url) || isHostedCheckoutSuccessUrl(url),
          HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS,
          500
        );
        transitionUrl = String(transitionTab?.url || '').trim();
      }

      if (isHostedCheckoutSuccessUrl(transitionUrl)) {
        await waitHostedSuccessDelayAndComplete(tabId, state, transitionUrl);
        return;
      }
      if (!isPayPalUrl(transitionUrl)) {
        throw new Error('步骤 6：PayPal 无卡直绑提交后未进入 PayPal 或支付成功页。');
      }

      const successUrl = await runHostedPayPalCheckout(tabId, guestProfile, config);
      await waitHostedSuccessDelayAndComplete(tabId, state, successUrl);
    }

    function normalizeHelperCountryCode(countryCode = '86') {
      const digits = String(countryCode || '').replace(/\D/g, '');
      return digits || '86';
    }

    function normalizeHelperPhoneNumber(phone = '', countryCode = '86') {
      const cleaned = String(phone || '').replace(/\D/g, '');
      const countryDigits = normalizeHelperCountryCode(countryCode);
      if (countryDigits && cleaned.startsWith(countryDigits) && cleaned.length > countryDigits.length) {
        return cleaned.slice(countryDigits.length);
      }
      return cleaned;
    }

    function normalizeGpcHelperPhoneMode(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizeGpcHelperPhoneMode) {
        return rootScope.GoPayUtils.normalizeGpcHelperPhoneMode(value);
      }
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === GPC_HELPER_PHONE_MODE_AUTO || normalized === 'builtin'
        ? GPC_HELPER_PHONE_MODE_AUTO
        : GPC_HELPER_PHONE_MODE_MANUAL;
    }

    function normalizeGpcOtpChannel(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizeGpcOtpChannel) {
        return rootScope.GoPayUtils.normalizeGpcOtpChannel(value);
      }
      return String(value || '').trim().toLowerCase() === 'sms' ? 'sms' : 'whatsapp';
    }

    function resolveGpcHelperApiKey(state = {}) {
      const apiKey = String(
        state?.gopayHelperApiKey
        || state?.gpcApiKey
        || state?.apiKey
        || ''
      ).trim();
      if (!apiKey) {
        throw new Error('创建 GPC 订单失败：缺少 API Key。');
      }
      return apiKey;
    }

    function normalizeGpcHelperBaseUrl(apiUrl = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizeGpcHelperBaseUrl) {
        return rootScope.GoPayUtils.normalizeGpcHelperBaseUrl(apiUrl);
      }
      let normalized = String(apiUrl || DEFAULT_GPC_HELPER_API_URL).trim().replace(/\/+$/g, '');
      normalized = normalized.replace(/\/api\/checkout\/start$/i, '');
      normalized = normalized.replace(/\/api\/gopay\/(?:otp|pin)$/i, '');
      normalized = normalized.replace(/\/api\/gp\/tasks(?:\/[^/?#]+)?(?:\/(?:otp|pin|stop))?(?:\?.*)?$/i, '');
      normalized = normalized.replace(/\/api\/gp\/balance(?:\?.*)?$/i, '');
      normalized = normalized.replace(/\/api\/card\/balance(?:\?.*)?$/i, '');
      normalized = normalized.replace(/\/api\/card\/redeem-api-key(?:\?.*)?$/i, '');
      return normalized || DEFAULT_GPC_HELPER_API_URL;
    }

    function buildGpcHelperApiUrl(apiUrl = '', path = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.buildGpcHelperApiUrl) {
        return rootScope.GoPayUtils.buildGpcHelperApiUrl(apiUrl, path);
      }
      const baseUrl = normalizeGpcHelperBaseUrl(apiUrl);
      if (!baseUrl) {
        return '';
      }
      const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
      return `${baseUrl}${normalizedPath}`;
    }

    function buildGpcTaskCreateUrl(apiUrl = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.buildGpcTaskCreateUrl) {
        return rootScope.GoPayUtils.buildGpcTaskCreateUrl(apiUrl);
      }
      return buildGpcHelperApiUrl(apiUrl, '/api/gp/tasks');
    }

    function buildGpcBalanceUrl(apiUrl = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.buildGpcApiKeyBalanceUrl) {
        return rootScope.GoPayUtils.buildGpcApiKeyBalanceUrl(apiUrl);
      }
      if (rootScope.GoPayUtils?.buildGpcCardBalanceUrl) {
        return rootScope.GoPayUtils.buildGpcCardBalanceUrl(apiUrl);
      }
      return buildGpcHelperApiUrl(apiUrl, '/api/gp/balance');
    }

    function unwrapGpcResponse(payload = {}) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.unwrapGpcResponse) {
        return rootScope.GoPayUtils.unwrapGpcResponse(payload);
      }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)
        && Object.prototype.hasOwnProperty.call(payload, 'data')
        && (Object.prototype.hasOwnProperty.call(payload, 'code') || Object.prototype.hasOwnProperty.call(payload, 'message'))) {
        return payload.data ?? {};
      }
      return payload;
    }

    function isGpcUnifiedResponseOk(payload = {}) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.isGpcUnifiedResponseOk) {
        return rootScope.GoPayUtils.isGpcUnifiedResponseOk(payload);
      }
      if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'code')) {
        return true;
      }
      const code = Number(payload.code);
      return Number.isFinite(code) ? code >= 200 && code < 300 : String(payload.code || '').trim() === '200';
    }

    function getGpcResponseErrorDetail(payload = {}, status = 0) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.extractGpcResponseErrorDetail) {
        return rootScope.GoPayUtils.extractGpcResponseErrorDetail(payload, status);
      }
      return payload?.data?.detail || payload?.detail || payload?.message || payload?.error || `HTTP ${status || 0}`;
    }

    function getGpcRemainingUses(payload = {}) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.getGpcBalanceRemainingUses) {
        return rootScope.GoPayUtils.getGpcBalanceRemainingUses(payload);
      }
      const data = unwrapGpcResponse(payload);
      const numeric = Number(data?.remaining_uses ?? data?.remainingUses ?? data?.balance ?? data?.remaining);
      return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
    }

    function normalizeGpcAutoModePermissionValue(value) {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      const normalized = String(value ?? '').trim().toLowerCase();
      if (!normalized) {
        return null;
      }
      if (['true', '1', 'yes', 'y', 'on', 'enabled', 'enable'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'n', 'off', 'disabled', 'disable'].includes(normalized)) {
        return false;
      }
      return null;
    }

    function getGpcAutoModePermission(payload = {}) {
      const data = unwrapGpcResponse(payload);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
      }
      return normalizeGpcAutoModePermissionValue(
        data.auto_mode_enabled
        ?? data.autoModeEnabled
        ?? data.auto_enabled
        ?? data.autoEnabled
      );
    }

    function isGpcAutoModePermissionDenied(payload = {}) {
      return getGpcAutoModePermission(payload) === false;
    }

    async function assertGpcApiKeyReadyForCreate(state = {}, phoneMode = GPC_HELPER_PHONE_MODE_MANUAL, apiKey = '') {
      const apiUrl = buildGpcBalanceUrl(state?.gopayHelperApiUrl);
      if (!apiUrl) {
        throw new Error('创建 GPC 订单失败：缺少 API 地址。');
      }
      const { response, data } = await fetchJsonWithTimeout(apiUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
        },
      }, 30000);
      if (!response?.ok || !isGpcUnifiedResponseOk(data)) {
        const detail = getGpcResponseErrorDetail(data, response?.status || 0);
        throw new Error(`创建 GPC 订单失败：API Key 校验失败：${detail}`);
      }
      const balanceData = unwrapGpcResponse(data);
      const remainingUses = getGpcRemainingUses(balanceData);
      const status = String(balanceData?.status || balanceData?.card_status || balanceData?.cardStatus || '').trim().toLowerCase();
      if (status && status !== 'active') {
        throw new Error(`创建 GPC 订单失败：API Key 状态不可用（${status}）。`);
      }
      if (remainingUses !== null && remainingUses <= 0) {
        throw new Error('创建 GPC 订单失败：API Key 剩余次数不足。');
      }
      if (phoneMode === GPC_HELPER_PHONE_MODE_AUTO && isGpcAutoModePermissionDenied(balanceData)) {
        throw new Error('创建 GPC 订单失败：当前 GPC API Key 未开通自动模式。');
      }
    }

    async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
      const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (typeof fetcher !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法调用 GPC API。');
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const effectiveTimeoutMs = Math.max(1000, Number(timeoutMs) || 30000);
      let didTimeout = false;
      let timer = null;
      const buildTimeoutError = () => new Error(`GPC API 请求超时（>${Math.round(effectiveTimeoutMs / 1000)} 秒）：${url}`);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          didTimeout = true;
          reject(buildTimeoutError());
          if (controller) {
            controller.abort();
          }
        }, effectiveTimeoutMs);
      });
      try {
        const response = await Promise.race([
          fetcher(url, { ...options, ...(controller ? { signal: controller.signal } : {}) }),
          timeoutPromise,
        ]);
        const data = await Promise.race([
          response.json().catch(() => ({})),
          timeoutPromise,
        ]);
        return { response, data };
      } catch (error) {
        if (didTimeout || error?.name === 'AbortError') {
          throw buildTimeoutError();
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function readAccessTokenFromChatGptSessionTab(tabId) {
      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待 ChatGPT 页面完成加载，再继续获取 accessToken...',
      });

      const sessionResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'PLUS_CHECKOUT_GET_STATE',
        source: 'background',
        payload: {
          includeSession: true,
          includeAccessToken: true,
        },
      });
      if (sessionResult?.error) {
        throw new Error(sessionResult.error);
      }
      return String(sessionResult?.accessToken || sessionResult?.session?.accessToken || '').trim();
    }

    async function generateGpcCheckoutFromApi(accessToken = '', state = {}) {
      const token = String(accessToken || '').trim();
      if (!token) {
        throw new Error('创建 GPC 订单失败：缺少 accessToken。');
      }
      const apiUrl = buildGpcTaskCreateUrl(state?.gopayHelperApiUrl);
      if (!apiUrl) {
        throw new Error('创建 GPC 订单失败：缺少 API 地址。');
      }
      const phoneMode = normalizeGpcHelperPhoneMode(state?.gopayHelperPhoneMode || state?.phoneMode);
      const isAutoMode = phoneMode === GPC_HELPER_PHONE_MODE_AUTO;
      const phoneNumber = String(state?.gopayHelperPhoneNumber || '').trim();
      const countryCode = normalizeHelperCountryCode(state?.gopayHelperCountryCode || '86');
      const pin = String(state?.gopayHelperPin || '').trim();
      const apiKey = resolveGpcHelperApiKey(state);
      if (!isAutoMode && !phoneNumber) {
        throw new Error('创建 GPC 订单失败：手动模式缺少手机号。');
      }
      if (!isAutoMode && !pin) {
        throw new Error('创建 GPC 订单失败：手动模式缺少 PIN。');
      }

      throwIfStopped();
      await assertGpcApiKeyReadyForCreate(state, phoneMode, apiKey);
      throwIfStopped();
      const payload = {
        access_token: token,
        phone_mode: phoneMode,
      };
      if (!isAutoMode) {
        payload.country_code = countryCode;
        payload.phone_number = normalizeHelperPhoneNumber(phoneNumber, countryCode);
        payload.otp_channel = normalizeGpcOtpChannel(state?.gopayHelperOtpChannel);
      }

      const orderCreatedAt = Date.now();
      const { response, data } = await fetchJsonWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(payload),
      }, 30000);

      const taskData = unwrapGpcResponse(data);
      const taskId = String(taskData?.task_id || taskData?.taskId || '').trim();

      if (!response?.ok || !isGpcUnifiedResponseOk(data) || !taskId) {
        const detail = getGpcResponseErrorDetail(data, response?.status || 0);
        throw new Error(`创建 GPC 订单失败：${detail}`);
      }

      return {
        taskId,
        taskStatus: String(taskData?.status || '').trim(),
        statusText: String(taskData?.status_text || taskData?.statusText || '').trim(),
        remoteStage: String(taskData?.remote_stage || taskData?.remoteStage || '').trim(),
        orderCreatedAt,
        responsePayload: taskData && typeof taskData === 'object' && !Array.isArray(taskData) ? taskData : null,
        phoneMode: normalizeGpcHelperPhoneMode(taskData?.phone_mode || taskData?.phoneMode || phoneMode),
        country: 'ID',
        currency: 'IDR',
        checkoutSource: PLUS_PAYMENT_METHOD_GPC_HELPER,
      };
    }

    async function executeGpcCheckoutCreate(state = {}) {
      let accessToken = String(state?.contributionAccessToken || state?.accessToken || state?.chatgptAccessToken || '').trim();
      if (!accessToken) {
        await addLog('步骤 6：正在获取 accessToken...', 'info');
        const tokenTabId = await openFreshChatGptTabForCheckoutCreate();
        try {
          accessToken = await readAccessTokenFromChatGptSessionTab(tokenTabId);
        } finally {
          if (chrome?.tabs?.remove && Number.isInteger(tokenTabId)) {
            await chrome.tabs.remove(tokenTabId).catch(() => {});
          }
        }
      }
      if (!accessToken) {
        throw new Error('步骤 6：GPC 模式获取 accessToken 失败。');
      }

      await addLog('步骤 6：正在调用 GPC 接口创建订单...', 'info');
      const result = await generateGpcCheckoutFromApi(accessToken, state);
      await setState({
        plusCheckoutTabId: null,
        plusCheckoutUrl: '',
        plusCheckoutCountry: result.country || 'ID',
        plusCheckoutCurrency: result.currency || 'IDR',
        plusCheckoutSource: result.checkoutSource,
        gopayHelperTaskId: result.taskId,
        gopayHelperTaskStatus: result.taskStatus,
        gopayHelperStatusText: result.statusText,
        gopayHelperRemoteStage: result.remoteStage,
        gopayHelperTaskPayload: result.responsePayload,
        gopayHelperTaskProgressSignature: '',
        gopayHelperTaskProgressAt: 0,
        gopayHelperTaskProgressTaskId: result.taskId,
        gopayHelperReferenceId: '',
        gopayHelperGoPayGuid: '',
        gopayHelperRedirectUrl: '',
        gopayHelperNextAction: '',
        gopayHelperFlowId: '',
        gopayHelperChallengeId: '',
        gopayHelperStartPayload: null,
        gopayHelperOrderCreatedAt: result.orderCreatedAt || Date.now(),
      });
      await addLog(`步骤 6：GPC ${result.phoneMode === GPC_HELPER_PHONE_MODE_AUTO ? '自动' : '手动'}模式任务已创建（task_id: ${result.taskId}），准备继续下一步。`, 'info');
      await completeNodeFromBackground('plus-checkout-create', {
        plusCheckoutCountry: result.country || 'ID',
        plusCheckoutCurrency: result.currency || 'IDR',
        plusCheckoutSource: result.checkoutSource,
      });
    }

    async function executePlusCheckoutCreate(state = {}) {
      const paymentMethod = normalizePlusPaymentMethod(state?.plusPaymentMethod);
      if (paymentMethod === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        await executeGpcCheckoutCreate(state);
        return;
      }

      const paymentMethodLabel = getPlusPaymentMethodLabel(paymentMethod);
      const checkoutModeLabel = getCheckoutModeLabel(state);
      await addLog(`步骤 6：正在打开新的 ChatGPT 会话，准备创建${checkoutModeLabel}...`, 'info');
      const tabId = await openFreshChatGptTabForCheckoutCreate();

      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待 ChatGPT 页面完成加载，再继续创建订阅页...',
      });

      const result = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'CREATE_PLUS_CHECKOUT',
        source: 'background',
        payload: { paymentMethod },
      });

      if (result?.error) {
        throw new Error(result.error);
      }
      const targetCheckoutUrl = resolveCheckoutTargetUrl(result, paymentMethod);
      if (!targetCheckoutUrl) {
        throw new Error(`步骤 6：${checkoutModeLabel}未返回可用的订阅链接。`);
      }

      if (paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL_HOSTED) {
        await executeHostedCheckoutCreate(tabId, state, result);
        return;
      }

      await addLog(`步骤 6：${checkoutModeLabel}已创建，正在打开订阅页面...`, 'ok');
      await chrome.tabs.update(tabId, { url: targetCheckoutUrl, active: true });
      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待订阅页面完成加载...',
      });

      await setState({
        plusCheckoutTabId: tabId,
        plusCheckoutUrl: targetCheckoutUrl,
        plusCheckoutCountry: result.country || 'DE',
        plusCheckoutCurrency: result.currency || 'EUR',
        plusCheckoutSource: '',
      });

      await addLog(`步骤 6：Plus Checkout 页面已就绪（${paymentMethodLabel} / ${result.country || 'DE'} ${result.currency || 'EUR'}），准备继续下一步。`, 'info');

      await completeNodeFromBackground('plus-checkout-create', {
        plusCheckoutCountry: result.country || 'DE',
        plusCheckoutCurrency: result.currency || 'EUR',
      });
    }

    return {
      executePlusCheckoutCreate,
    };
  }

  return {
    createPlusCheckoutCreateExecutor,
  };
});
