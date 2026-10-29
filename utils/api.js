const { API_BASE_URL, AUTH_STORAGE_KEY } = require('./constants');

class ApiError extends Error {
  constructor(message, status, code, retryAfter, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
  }
}

function apiErrorFromResponse(payload, status, headers) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const rawError = body.error;
  const structured = rawError && typeof rawError === 'object' ? rawError : null;
  const code = structured && typeof structured.code === 'string'
    ? structured.code
    : typeof rawError === 'string'
      ? rawError
      : `REQUEST_FAILED_${status}`;
  const message = structured && typeof structured.message === 'string'
    ? structured.message
    : typeof rawError === 'string'
      ? rawError
      : code;
  const retryAfterHeader = headers && (headers['Retry-After'] || headers['retry-after']);
  const retryAfter = typeof body.retryAfter === 'number'
    ? body.retryAfter
    : Number.isFinite(Number(retryAfterHeader))
      ? Number(retryAfterHeader)
      : undefined;

  return new ApiError(
    message,
    status,
    code,
    retryAfter,
    typeof body.requestId === 'string' ? body.requestId : undefined
  );
}

function clearStoredSession() {
  wx.removeStorageSync(AUTH_STORAGE_KEY);
}

function getStoredToken() {
  const session = wx.getStorageSync(AUTH_STORAGE_KEY);
  return session && typeof session.token === 'string' ? session.token : '';
}

function apiRequest(path, options = {}) {
  const method = options.method || 'GET';
  const headers = Object.assign(
    { Accept: "application/json" },
    options.data === undefined ? {} : { "Content-Type": "application/json" },
    options.headers || {}
  );
  if (options.auth !== false) {
    const token = getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method,
      data: options.data,
      header: headers,
      timeout: options.timeout || 15000,
      success(response) {
        const payload = response.data;
        const successfulStatus = response.statusCode >= 200 && response.statusCode < 300;
        const rejectedPayload = payload && typeof payload === 'object'
          && payload.success === false
          && options.allowUnsuccessfulPayload !== true;
        if (!successfulStatus || rejectedPayload) {
          if (response.statusCode === 401 && options.auth !== false) clearStoredSession();
          reject(apiErrorFromResponse(payload, response.statusCode, response.header));
          return;
        }
        if ((payload === null || payload === undefined) && response.statusCode !== 204) {
          reject(new ApiError('INVALID_API_RESPONSE', response.statusCode, 'INVALID_API_RESPONSE'));
          return;
        }
        resolve(payload);
      },
      fail() {
        reject(new ApiError('NETWORK_ERROR', 0, 'NETWORK_ERROR'));
      }
    });
  });
}

function toQuery(parameters) {
  const entries = Object.entries(parameters)
    .filter(function (entry) { return entry[1] !== undefined && entry[1] !== null && entry[1] !== ""; });
  return entries.length ? "?" + entries.map(function (entry) { return encodeURIComponent(entry[0]) + "=" + encodeURIComponent(String(entry[1])); }).join("&") : "";
}

function getAssetUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.startsWith('http://') || value.startsWith('data:')) return '';
  if (value.startsWith('https://')) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${API_BASE_URL}${value}`;
  return `${API_BASE_URL}/${value}`;
}

function getAccountPreferences(role, accountId) {
  const query = '?role=' + encodeURIComponent(role) + '&accountId=' + encodeURIComponent(accountId);
  return apiRequest('/api/account/preferences' + query);
}

function saveAccountPreferences(role, accountId, patch) {
  const query = '?role=' + encodeURIComponent(role) + '&accountId=' + encodeURIComponent(accountId);
  return apiRequest('/api/account/preferences' + query, { method: 'PUT', data: patch });
}

function getExchangeRates() {
  return apiRequest('/api/exchange-rates/latest', { auth: false });
}

function getProducts(parameters = {}) {
  return apiRequest(`/api/products${toQuery(parameters)}`);
}

function getProduct(productId) {
  return apiRequest(`/api/products/${encodeURIComponent(productId)}`);
}

function getMerchants(searchTerm) {
  return apiRequest(`/api/merchants${toQuery({ q: searchTerm })}`, { auth: false });
}

function getFashionEditorial() {
  return apiRequest('/api/fashion/editorial', { auth: false });
}

function getFashionTaxonomy() {
  return apiRequest('/api/fashion/taxonomy', { auth: false });
}

function getFashionPosts(parameters = {}) {
  return apiRequest(`/api/fashion/posts${toQuery(parameters)}`, {
    auth: parameters.saved === 'true' || parameters.following === 'true'
  });
}

function getFashionCreatorProfile(id) {
  return apiRequest(`/api/fashion/creators/${encodeURIComponent(id)}`);
}

function getFashionMerchants() {
  return apiRequest('/api/fashion/merchants', { auth: false });
}

function redeemStoreAccessCode(code) {
  return apiRequest('/api/vault/store-access/redeem', { method: 'POST', data: { code } });
}

function getFashionSocial(ids) {
  return apiRequest(`/api/fashion/social${toQuery({ ids: ids.join(',') })}`);
}

function reactFashionPost(id, _viewerId, reaction) {
  return apiRequest(`/api/fashion/social/${encodeURIComponent(id)}/reaction`, { method: 'POST', data: { reaction } });
}

function recordFashionPostView(id, watchedMs, completed) {
  return apiRequest(`/api/fashion/posts/${encodeURIComponent(id)}/view`, {
    method: 'POST',
    data: { watchedMs: Math.max(0, Math.round(Number(watchedMs) || 0)), completed: Boolean(completed) }
  });
}

function followFashionCreator(id) {
  return apiRequest(`/api/fashion/social/${encodeURIComponent(id)}/follow`, { method: 'POST', data: {} });
}

function getFashionComments(id, limit = 100, offset = 0) {
  return apiRequest(`/api/fashion/social/${encodeURIComponent(id)}/comments${toQuery({ limit, offset })}`);
}

function addFashionComment(id, _viewerId, text, parentId) {
  return apiRequest(`/api/fashion/social/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    data: { text, ...(parentId ? { parentId } : {}) }
  });
}

function deleteFashionComment(postId, commentId) {
  return apiRequest(`/api/fashion/social/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE'
  });
}

function reportFashionContent(targetType, targetId, reason, detail) {
  return apiRequest('/api/fashion/reports', {
    method: 'POST',
    data: { targetType, targetId, reason, detail: detail || '' }
  });
}

// Owner-scoped product search: only products the signed-in account may manage.
function searchFashionCreatorProducts(query) {
  return apiRequest(`/api/fashion/products/search${toQuery({ q: query, limit: 12 })}`);
}

function recordFashionProductClick(postId, productId) {
  return apiRequest(`/api/fashion/posts/${encodeURIComponent(postId)}/products/${encodeURIComponent(productId)}/click`, {
    method: 'POST',
    data: {}
  });
}

function activateFashionAccount() {
  return apiRequest('/api/fashion/account/activate', { method: 'POST', data: {} });
}

function getFashionAccountMe() {
  return apiRequest('/api/fashion/account/me');
}

function updateFashionAccountProfile(data) {
  return apiRequest('/api/fashion/account/profile', { method: 'PUT', data });
}

function generateFashionCaption(data) {
  return apiRequest('/api/fashion/ai/caption', { method: 'POST', data });
}

function translateFashionText(data) {
  return apiRequest('/api/fashion/ai/translate', { method: 'POST', data });
}

function uploadFashionImagePost(filePath, formData) {
  const session = wx.getStorageSync(AUTH_STORAGE_KEY);
  const header = session && session.token ? { Authorization: 'Bearer ' + session.token } : {};
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: API_BASE_URL + '/api/fashion/posts/mixed',
      filePath,
      name: 'media-0',
      formData,
      header,
      timeout: 300000,
      success(response) {
        if (response.statusCode === 401) clearStoredSession();
        let payload;
        try { payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data; }
        catch (_error) { reject(new ApiError('INVALID_API_RESPONSE', response.statusCode, 'INVALID_API_RESPONSE')); return; }
        if (response.statusCode < 200 || response.statusCode >= 300 || !payload || payload.success === false) {
          reject(apiErrorFromResponse(payload, response.statusCode, response.header));
          return;
        }
        resolve(payload);
      },
      fail(error) {
        const message = String(error && error.errMsg || '').toLowerCase();
        const code = message.includes('timeout') ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
        reject(new ApiError(code, 0, code));
      }
    });
  });
}

function uploadFashionPostAsset(filePath, metadata, onProgress) {
  const session = wx.getStorageSync(AUTH_STORAGE_KEY);
  const header = session && session.token ? { Authorization: 'Bearer ' + session.token } : {};
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: API_BASE_URL + '/api/fashion/posts/mixed/assets',
      filePath,
      name: 'file',
      formData: {
        type: metadata.type,
        kind: metadata.kind,
        filename: metadata.filename,
        ...(metadata.draft ? { draft: 'true' } : {})
      },
      header,
      timeout: 300000,
      success(response) {
        if (response.statusCode === 401) clearStoredSession();
        let payload;
        try {
          payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } catch (_error) {
          reject(new ApiError('INVALID_API_RESPONSE', response.statusCode, 'INVALID_API_RESPONSE'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || !payload || payload.success === false) {
          reject(apiErrorFromResponse(payload, response.statusCode, response.header));
          return;
        }
        if (typeof payload.uploadToken !== 'string' || !payload.uploadToken) {
          reject(new ApiError('INVALID_API_RESPONSE', response.statusCode, 'INVALID_API_RESPONSE'));
          return;
        }
        resolve(payload);
      },
      fail(error) {
        const message = String(error && error.errMsg || '').toLowerCase();
        const code = message.includes('timeout') ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
        reject(new ApiError(code, 0, code));
      }
    });
    if (task && typeof task.onProgressUpdate === 'function' && typeof onProgress === 'function') {
      task.onProgressUpdate(onProgress);
    }
  });
}

function submitFashionMixedPost(data) {
  return apiRequest('/api/fashion/posts/mixed', {
    method: 'POST',
    data,
    timeout: 60000
  });
}

function getFashionDrafts() {
  return apiRequest('/api/fashion/drafts', { timeout: 20000 });
}

function createFashionDraft(data) {
  return apiRequest('/api/fashion/drafts', {
    method: 'POST',
    data,
    timeout: 60000
  });
}

function updateFashionDraft(id, data) {
  return apiRequest(`/api/fashion/drafts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    data,
    timeout: 60000
  });
}

function deleteFashionDraft(id) {
  return apiRequest(`/api/fashion/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

function hideFashionPost(postId) {
  return apiRequest(`/api/fashion/posts/${encodeURIComponent(postId)}/hide`, {
    method: 'POST',
    data: {}
  });
}

function blockFashionCreator(accountId) {
  return apiRequest('/api/fashion/blocks', {
    method: 'POST',
    data: { accountId }
  });
}

function unblockFashionCreator(accountId) {
  return apiRequest(`/api/fashion/blocks/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  });
}

function getFashionAnalytics() {
  return apiRequest('/api/fashion/account/analytics', { timeout: 20000 });
}

function deleteFashionPost(postId) {
  return apiRequest(`/api/fashion/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE'
  });
}

function getFashionNotifications(limit = 20, offset = 0) {
  return apiRequest(`/api/fashion/notifications${toQuery({ limit, offset })}`);
}

function markFashionNotificationsRead(payload = { all: true }) {
  return apiRequest('/api/fashion/notifications/read', { method: 'POST', data: payload });
}

function deleteFashionNotification(id) {
  return apiRequest(`/api/fashion/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function getFashionTags() {
  return apiRequest('/api/fashion/tags', { auth: false });
}

function postModaGptMessage(message, history = []) {
  return apiRequest('/api/modagpt/public/chat', {
    method: 'POST',
    auth: false,
    data: { message, history, language: 'zh' }
  });
}

function getMiniProgramFeatures() {
  return apiRequest('/api/miniprogram/features', { auth: false });
}

function getStoreBySlug(storeSlug) {
  return apiRequest(`/api/merchants/store/${encodeURIComponent(storeSlug)}`);
}

function getStoreByLookupCode(code) {
  return apiRequest(`/api/merchants/code/${encodeURIComponent(code)}`, { auth: false });
}

function getStoreLookupQrUrl(code) {
  return `${API_BASE_URL}/api/merchants/code/${encodeURIComponent(code)}/qr.png`;
}

function requestVaultAccess(merchantId, note) {
  return apiRequest('/api/vault/request', {
    method: 'POST',
    data: { merchantId, note }
  });
}

function getVaultStatuses(merchantIds) {
  const ids = Array.isArray(merchantIds) ? merchantIds.filter(Boolean).slice(0, 100) : [];
  return apiRequest(`/api/vault/status?merchantIds=${encodeURIComponent(ids.join(','))}`);
}

function login(role, data) {
  if (!['buyer', 'merchant', 'employee'].includes(role)) {
    return Promise.reject(new ApiError('LOGIN_ROLE_INVALID', 400, 'LOGIN_ROLE_INVALID'));
  }
  return apiRequest(`/api/miniprogram/auth/login/${role}`, {
    method: 'POST',
    data,
    auth: false
  });
}

function loginWithWechat(code) {
  return apiRequest('/api/miniprogram/auth/wechat/login', {
    method: 'POST',
    data: { code },
    auth: false
  });
}

function requestQuickBuyerRegistrationCode(email) {
  return apiRequest('/api/auth/register/quick/request', {
    method: 'POST',
    auth: false,
    data: { email }
  });
}

function verifyQuickBuyerRegistration(email, code, password, acceptedLegal) {
  return apiRequest('/api/auth/register/quick/verify', {
    method: 'POST',
    auth: false,
    data: { email, code, password, acceptedTerms: acceptedLegal, acceptedPrivacy: acceptedLegal }
  });
}

function bindWechatIdentity(code) {
  return apiRequest('/api/miniprogram/auth/wechat/bind', {
    method: 'POST',
    data: { code }
  });
}

function getAuthProfile(role) {
  if (!['buyer', 'merchant', 'employee'].includes(role)) {
    return Promise.reject(new ApiError('LOGIN_ROLE_INVALID', 400, 'LOGIN_ROLE_INVALID'));
  }
  return apiRequest(`/api/auth/me/${role}`, { allowUnsuccessfulPayload: true });
}

function getBuyerAuthorizations() {
  return apiRequest('/api/vault/authorizations');
}

function getBuyerNotifications(limit) {
  return apiRequest('/api/notifications' + toQuery({ limit }));
}

function markBuyerNotificationRead(notificationId) {
  return apiRequest(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
    data: {}
  });
}

function createOrder(masterOrder, legalConsent) {
  return apiRequest('/api/orders', {
    method: 'POST',
    data: Object.assign({ masterOrder }, legalConsent || {})
  });
}

function createProductReservationRequest(productId, items) {
  return apiRequest('/api/product-reservation-requests', {
    method: 'POST',
    data: { productId, items }
  });
}

function createSupportRequest(request) {
  return apiRequest('/api/support-requests', {
    method: 'POST',
    auth: false,
    data: request
  });
}

function getBuyerOrders() {
  return apiRequest('/api/orders');
}

function getBuyerOrderShipments(orderId) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}/shipments`);
}

function confirmBuyerOrderAgreement(orderId, agreementId) {
  return apiRequest(
    `/api/orders/${encodeURIComponent(orderId)}/agreements/${encodeURIComponent(agreementId)}/confirm`,
    { method: 'POST', data: {} }
  );
}

function proposeBuyerOrderAgreement(orderId, agreementId, terms) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}/agreements`, {
    method: 'POST',
    data: { agreementId, terms }
  });
}

function submitBuyerOrderPayment(orderId, paymentMethod, paymentReference) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}/payment`, {
    method: 'POST',
    data: { paymentMethod, ...(paymentReference ? { paymentReference } : {}) }
  });
}

function cancelBuyerOrder(orderId, reason) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    data: { reason }
  });
}

function getMerchantProducts() {
  return apiRequest('/api/merchant/products');
}

function createMerchantProduct(product) {
  return apiRequest('/api/merchant/products', {
    method: 'POST',
    data: product
  });
}

function presignMerchantMedia(contentType, fileSize) {
  return apiRequest('/api/merchant/media/presign', {
    method: 'POST',
    data: { contentType, fileSize }
  });
}

function updateMerchantProduct(productId, updates) {
  return apiRequest(`/api/merchant/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    data: updates
  });
}

function adjustMerchantInventory(adjustment) {
  return apiRequest('/api/merchant/inventory/adjustments', {
    method: 'POST',
    data: adjustment
  });
}

function getMerchantOrders() {
  return apiRequest('/api/merchant/orders');
}

function updateMerchantOrderFulfillment(orderId, update) {
  return apiRequest(`/api/merchant/orders/${encodeURIComponent(orderId)}/fulfill`, {
    method: 'PUT',
    data: update
  });
}

function getMerchantInventory() {
  return apiRequest('/api/merchant/inventory/balances');
}

module.exports = {
  ApiError,
  apiRequest,
  getProducts,
  getAccountPreferences,
  saveAccountPreferences,
  getExchangeRates,
  getAssetUrl,
  getProduct,
  getMerchants,
  getFashionEditorial,
  getFashionNotifications,
  markFashionNotificationsRead,
  deleteFashionNotification,
  getFashionTags,
  getFashionTaxonomy,
  getFashionPosts,
  getFashionCreatorProfile,
  getFashionMerchants,
  redeemStoreAccessCode,
  getFashionSocial,
  reactFashionPost,
  recordFashionPostView,
  followFashionCreator,
  getFashionComments,
  addFashionComment,
  deleteFashionComment,
  reportFashionContent,
  searchFashionCreatorProducts,
  recordFashionProductClick,
  activateFashionAccount,
  getFashionAccountMe,
  updateFashionAccountProfile,
  generateFashionCaption,
  translateFashionText,
  uploadFashionImagePost,
  uploadFashionPostAsset,
  submitFashionMixedPost,
  getFashionDrafts,
  createFashionDraft,
  updateFashionDraft,
  deleteFashionDraft,
  hideFashionPost,
  blockFashionCreator,
  unblockFashionCreator,
  getFashionAnalytics,
  deleteFashionPost,
  postModaGptMessage,
  getMiniProgramFeatures,
  getStoreBySlug,
  getStoreByLookupCode,
  getStoreLookupQrUrl,
  requestVaultAccess,
  getVaultStatuses,
  login,
  loginWithWechat,
  requestQuickBuyerRegistrationCode,
  verifyQuickBuyerRegistration,
  bindWechatIdentity,
  getAuthProfile,
  getBuyerAuthorizations,
  getBuyerNotifications,
  markBuyerNotificationRead,
  createOrder,
  createProductReservationRequest,
  createSupportRequest,
  getBuyerOrders,
  getBuyerOrderShipments,
  confirmBuyerOrderAgreement,
  proposeBuyerOrderAgreement,
  submitBuyerOrderPayment,
  cancelBuyerOrder,
  getMerchantProducts,
  createMerchantProduct,
  presignMerchantMedia,
  updateMerchantProduct,
  adjustMerchantInventory,
  getMerchantOrders,
  updateMerchantOrderFulfillment,
  getMerchantInventory
};
