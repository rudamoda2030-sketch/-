const { createOrder } = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');
const { readCart, clearCart } = require('../../utils/cart');
const { formatEurAmount } = require('../../utils/preferences');

function orderNumber() {
  return `WX${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

Page({
  data: {
    street: '',
    city: '',
    country: '',
    zip: '',
    notes: '',
    deliveryType: 'shipping',
    acceptedTerms: false,
    acceptedPrivacy: false,
    loading: false,
    itemCount: 0,
    estimatedTotal: '0.00',
    displayEstimatedTotal: '€0.00',
    error: ''
  },

  onShow() {
    const session = getAuthSession();
    if (!session || session.role !== 'buyer') {
      wx.redirectTo({ url: '/pages/login/index?role=buyer' });
      return;
    }
    const items = readCart();
    if (!items.length) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    this._items = items;
    this.setData({
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      estimatedTotal: items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0).toFixed(2),
      displayEstimatedTotal: formatEurAmount(items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0)) || ('€' + items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0).toFixed(2))
    });
  },

  onFieldInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: '' });
  },

  onLegalConsentChange(event) {
    const values = event.detail.value || [];
    this.setData({
      acceptedTerms: values.includes('terms'),
      acceptedPrivacy: values.includes('privacy'),
      error: ''
    });
  },

  openLegalDocument(event) {
    const routes = {
      terms: '/pages/service-agreement/index',
      privacy: '/pages/privacy/index'
    };
    const route = routes[event.currentTarget.dataset.document];
    if (route) wx.navigateTo({ url: route });
  },

  async submitOrder() {
    if (this.data.loading) return;
    if (!this.data.acceptedTerms || !this.data.acceptedPrivacy) {
      this.setData({ error: '提交订单前，请阅读并同意《用户服务协议》和《隐私政策》。' });
      return;
    }
    const { street, city, country, zip } = this.data;
    if (![street, city, country, zip].every(value => value.trim())) {
      this.setData({ error: '请完整填写街道、城市、国家和邮编。' });
      return;
    }
    const items = this._items || readCart();
    if (!items.length) {
      this.setData({ error: '购物车已空，请返回商城重新选择。' });
      return;
    }
    if (!this._orderNo) this._orderNo = orderNumber();
    const now = new Date().toISOString();
    const masterOrder = {
      orderNo: this._orderNo,
      date: now.slice(0, 10),
      items: items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        color: item.color || '',
        size: item.size || '',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice) || 0,
        merchantId: item.merchantId,
        merchantName: item.merchantName
      })),
      totalQty: this.data.itemCount,
      totalAmount: Number(this.data.estimatedTotal),
      status: 'pending',
      deliveryType: this.data.deliveryType,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'unpaid',
      shippingAddress: { street: street.trim(), city: city.trim(), country: country.trim(), zip: zip.trim() },
      notes: this.data.notes.trim(),
      timeline: [{ status: 'pending', title: '订单已提交', time: now, completed: true }]
    };

    this.setData({ loading: true, error: '' });
    try {
      const response = await createOrder(masterOrder, {
        miniprogram: true,
        acceptedTerms: this.data.acceptedTerms,
        acceptedPrivacy: this.data.acceptedPrivacy
      });
      if (!response.orders || response.orders.length === 0) throw new Error('ORDER_RESPONSE_INVALID');
      clearCart();
      this._orderNo = '';
      wx.redirectTo({ url: '/pages/orders/index?submitted=1' });
    } catch (error) {
      const messages = {
        BUYER_KYC_NOT_APPROVED: '买家资质尚未审核通过，暂时不能下单。',
        BUYER_PROFILE_REQUIRED: '当前买家账号资料不完整，请联系 RUDA 支持。',
        MOQ_NOT_MET: '商品数量未达到起订量，请调整购物车数量。',
        CARTON_MULTIPLE_REQUIRED: '商品数量需符合整箱装箱数，请调整购物车数量。',
        SKU_NOT_AVAILABLE: '所选规格已不可购买，请返回商品页刷新。',
        INSUFFICIENT_STOCK: '该规格不支持订货且现货不足，请调整数量。',
        PAYMENT_AFTER_MERCHANT_ACCEPTANCE: '请先提交订单，商家接受后再选择付款方式。',
        INVENTORY_CHANGED_RETRY_ORDER: '库存刚刚发生变化，请刷新购物车后重试。',
        PRODUCT_NOT_AVAILABLE: '有商品已下架或不可购买，请重新选择商品。',
        SHOWCASE_PRODUCT_ORDER_DISABLED: '该展示商品暂不支持下单。',
        PRIVATE_PRODUCT_NOT_AUTHORIZED: '当前账号未获该商品的购买授权。'
      };
      this.setData({
        error: messages[error && error.code] || (error && error.message) || '订单提交失败，请检查信息后重试。'
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
