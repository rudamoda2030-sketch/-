const {
  adjustMerchantInventory,
  getAssetUrl,
  getMerchantInventory,
  getMerchantOrders,
  getMerchantProducts,
  updateMerchantProduct,
  updateMerchantOrderFulfillment
} = require('../../utils/api');
const { clearAuthSession, getAuthSession, getVerifiedAuthProfile } = require('../../utils/auth');
const { formatEurAmount } = require('../../utils/preferences');

Page({
  data: {
    loading: false,
    error: '',
    merchant: null,
    account: null,
    role: '',
    activeModule: '',
    workspaceLoading: false,
    workspaceError: '',
    products: [],
    orders: [],
    balances: [],
    selectedBalance: null,
    adjustmentQuantity: '',
    adjustmentNote: '',
    modules: [
      { id: 'products', title: '商品管理', description: '商品资料与上架状态' },
      { id: 'inventory', title: '库存管理', description: 'SKU 库存与可售数量' },
      { id: 'orders', title: '订单管理', description: '采购订单与履约进度' },
      { id: 'storefront', title: '店铺管理', description: '品牌资料与独立店铺' }
    ]
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true, error: '' });
    try {
      const session = getAuthSession();
      if (!session || !['merchant', 'employee'].includes(session.role)) {
        this.setData({ merchant: null, account: null, role: '', activeModule: '' });
        return;
      }
      const auth = await getVerifiedAuthProfile();
      if (!auth || !['merchant', 'employee'].includes(auth.session.role)) {
        this.setData({ merchant: null, account: null, role: '', activeModule: '' });
        return;
      }
      const merchant = auth.response.merchant;
      const account = auth.session.role === 'employee'
        ? auth.response.employee
        : auth.response.merchant;
      this.setData({
        merchant: merchant || null,
        account: account || null,
        role: auth.session.role,
        activeModule: '',
        workspaceError: ''
      });
    } catch (error) {
      this.setData({
        merchant: null,
        account: null,
        role: '',
        activeModule: '',
        error: error.message || 'MERCHANT_PROFILE_LOAD_FAILED'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  openMerchantLogin() {
    wx.navigateTo({ url: '/pages/login/index?role=merchant' });
  },

  openEmployeeLogin() {
    wx.navigateTo({ url: '/pages/login/index?role=employee' });
  },

  openMerchantRegistration() {
    const url = 'https://modaui.com/register-wholesale?registration=merchant';
    wx.navigateTo({
      url: `/pages/webview/index?url=${encodeURIComponent(url)}&title=${encodeURIComponent('商家入驻')}`
    });
  },

  openModule(event) {
    const moduleId = event.currentTarget.dataset.id;
    if (!this.data.merchant) {
      this.openMerchantLogin();
      return;
    }
    this.setData({ activeModule: moduleId, workspaceError: '' });
    if (moduleId !== 'storefront') void this.loadWorkspace(moduleId);
  },

  async loadWorkspace(moduleId) {
    this.setData({ workspaceLoading: true, workspaceError: '' });
    try {
      if (moduleId === 'products') {
        const response = await getMerchantProducts();
        this.setData({
          products: (response.products || []).map(product => ({
            ...product,
            coverImage: getAssetUrl((product.images || [])[0]),
            displayPrice: formatEurAmount(product.wholesalePrice) || ('€' + product.wholesalePrice),
            nextLifecycleAction: product.lifecycleStatus === 'published' ? '暂停销售' : '提交审核',
            nextLifecycleStatus: product.lifecycleStatus === 'published' ? 'draft' : 'pending_review'
          }))
        });
      } else if (moduleId === 'orders') {
        const response = await getMerchantOrders();
        this.setData({
          orders: (response.orders || []).map(order => ({
            ...order,
            displayAmount: formatEurAmount(order.totalAmount) || ('€' + Number(order.totalAmount || 0).toFixed(2)),
            nextStatus: ({
              pending: 'confirmed',
              placed: 'confirmed',
              confirmed: 'picking',
              picking: 'shipped',
              shipped: 'delivered'
            })[order.status] || ''
          }))
        });
      } else if (moduleId === 'inventory') {
        const response = await getMerchantInventory();
        this.setData({ balances: response.balances || [] });
      }
    } catch (error) {
      this.setData({ workspaceError: error.message || '工作区暂时无法加载，请确认当前账号权限。' });
    } finally {
      this.setData({ workspaceLoading: false });
    }
  },

  backToModules() {
    this.setData({ activeModule: '', workspaceError: '' });
  },

  async updateProductLifecycle(event) {
    const productId = event.currentTarget.dataset.id;
    const lifecycleStatus = event.currentTarget.dataset.status;
    const product = this.data.products.find(item => item.id === productId);
    if (!product || !lifecycleStatus) return;
    try {
      await updateMerchantProduct(productId, { lifecycleStatus });
      wx.showToast({ title: lifecycleStatus === 'draft' ? '商品已暂停' : '已提交审核', icon: 'success' });
      await this.loadWorkspace('products');
    } catch (error) {
      wx.showToast({ title: error.message || '商品状态更新失败', icon: 'none' });
    }
  },

  editProduct(event) {
    const productId = event.currentTarget.dataset.id;
    if (productId) wx.navigateTo({ url: `/pages/product-edit/index?productId=${encodeURIComponent(productId)}` });
  },

  createProduct() {
    wx.navigateTo({ url: '/pages/product-create/index' });
  },

  selectInventoryBalance(event) {
    const balance = this.data.balances.find(item => item.id === event.currentTarget.dataset.id);
    if (balance) this.setData({ selectedBalance: balance, adjustmentQuantity: '', adjustmentNote: '' });
  },

  onAdjustmentInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'quantity' || field === 'note') {
      this.setData({
        [field === 'quantity' ? 'adjustmentQuantity' : 'adjustmentNote']: event.detail.value
      });
    }
  },

  async submitInventoryAdjustment() {
    const balance = this.data.selectedBalance;
    const quantity = Number(this.data.adjustmentQuantity);
    const note = this.data.adjustmentNote.trim();
    if (!balance || !Number.isInteger(quantity) || quantity === 0 || !note) {
      wx.showToast({ title: '请输入非零整数和调整原因', icon: 'none' });
      return;
    }
    try {
      await adjustMerchantInventory({
        balanceId: balance.id,
        variantId: balance.variantId,
        locationId: balance.location.id,
        version: balance.version,
        quantity,
        note
      });
      wx.showToast({ title: '库存已调整', icon: 'success' });
      this.setData({ selectedBalance: null, adjustmentQuantity: '', adjustmentNote: '' });
      await this.loadWorkspace('inventory');
    } catch (error) {
      wx.showToast({ title: error.message || '库存调整失败，请刷新后重试', icon: 'none' });
    }
  },

  onFulfillmentInput(event) {
    const { id, field } = event.currentTarget.dataset;
    if (!['carrierInput', 'trackingInput'].includes(field)) return;
    this.setData({
      orders: this.data.orders.map(order => order.id === id
        ? { ...order, [field]: event.detail.value }
        : order)
    });
  },

  async advanceOrder(event) {
    const order = this.data.orders.find(item => item.id === event.currentTarget.dataset.id);
    if (!order || !order.nextStatus) return;
    if (order.nextStatus === 'shipped' && order.deliveryType === 'shipping'
      && (!order.carrierInput || !order.carrierInput.trim() || !order.trackingInput || !order.trackingInput.trim())) {
      wx.showToast({ title: '请填写承运商和物流单号', icon: 'none' });
      return;
    }
    try {
      await updateMerchantOrderFulfillment(order.id, {
        status: order.nextStatus,
        ...(order.carrierInput ? { carrier: order.carrierInput.trim() } : {}),
        ...(order.trackingInput ? { trackingNumber: order.trackingInput.trim() } : {})
      });
      wx.showToast({ title: '订单履约状态已更新', icon: 'success' });
      await this.loadWorkspace('orders');
    } catch (error) {
      const message = error && error.code === 'MULTI_MERCHANT_SUBORDER_REQUIRED'
        ? '多商家主订单不能在此直接履约，请操作对应商家子订单。'
        : error && error.code === 'INVALID_ORDER_TRANSITION'
          ? '订单状态已变化，请刷新后重试。'
          : error && error.message
            ? error.message
            : '订单状态更新失败，请稍后重试。';
      wx.showToast({ title: message, icon: 'none' });
    }
  },

  openStore() {
    const storeSlug = this.data.merchant && this.data.merchant.storeSlug;
    if (storeSlug) {
      wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(storeSlug)}` });
    }
  },

  logout() {
    clearAuthSession();
    this.setData({
      merchant: null,
      account: null,
      role: '',
      activeModule: '',
      products: [],
      orders: [],
      balances: [],
      selectedBalance: null
    });
  }
});
