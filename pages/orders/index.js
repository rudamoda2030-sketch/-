const {
  cancelBuyerOrder,
  confirmBuyerOrderAgreement,
  getBuyerOrders,
  getBuyerOrderShipments,
  proposeBuyerOrderAgreement,
  submitBuyerOrderPayment
} = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');
const { filterBuyerOrders, orderFilterLabel, ORDER_FILTERS } = require('../../utils/order-summary');
const { formatEurAmount } = require('../../utils/preferences');

function presentOrder(order) {
  const currentAgreement = (order.agreementVersions || []).reduce((latest, agreement) =>
    !latest || agreement.version > latest.version ? agreement : latest, null);
  const agreementTerms = currentAgreement && currentAgreement.terms;
  const currentTask = order.currentTasks && order.currentTasks.buyer;
  const currentStep = currentTask ? currentTask.phase : order.status === 'delivered' ? 4
    : order.status === 'shipped' ? 3
      : order.status === 'picking' || order.paymentStatus === 'paid' || order.paymentStatus === 'pending_credit' ? 2
        : order.status === 'confirmed' ? 2
          : order.status === 'cancelled' || order.status === 'returned' ? -1 : 0;
  const statusLabels = {
    placed: '待商家确认',
    pending: '待商家确认',
    confirmed: '商家已接受',
    picking: '备货中',
    shipped: '已发货',
    delivered: '已送达',
    cancelled: '已取消'
  };
  const paymentLabels = {
    unpaid: '待付款',
    pending: '付款处理中',
    paid: '已付款',
    pending_credit: '账期处理中',
    payment_required: '待付款',
    payment_failed: '付款失败'
  };
  const paymentPlanLabels = {
    full_prepayment: '全额预付',
    ship_before_payment: '先发货后付款',
    partial_prepayment: '部分预付',
    cash_on_delivery: '送达时付款',
    custom: '自定义'
  };
  return {
    ...order,
    currentAgreement: currentAgreement ? Object.assign({}, currentAgreement, {
      paymentPlanLabel: paymentPlanLabels[agreementTerms.paymentPlan] || agreementTerms.paymentPlan,
      displayItems: (agreementTerms.items || []).map(item => {
        const orderItem = (order.items || []).find(candidate => candidate.id === item.orderItemId);
        return Object.assign({}, item, {
          label: orderItem ? `${orderItem.productName} · ${orderItem.sku} · ${orderItem.color || ''} / ${orderItem.size || ''}` : item.orderItemId
        });
      })
    }) : null,
    canConfirmAgreement: currentTask && currentTask.action === 'confirm_agreement',
    canProposeAgreement: currentAgreement && currentAgreement.status === 'pending_buyer',
    paymentMethod: agreementTerms && agreementTerms.paymentMethod || order.paymentMethod,
    canPay: currentTask && (currentTask.action === 'pay' || currentTask.action === 'pay_balance'),
    isBankTransfer: ['bank_transfer', 'bank_transfer_prepay'].includes(agreementTerms && agreementTerms.paymentMethod || order.paymentMethod),
    progressSteps: ['待确认', '约定确认中', '处理中', '运输中', '已送达/已完成'].map((label, index) => ({
      label,
      complete: currentStep >= 0 && (index < currentStep || (currentTask && currentTask.label === '已完成')),
      active: index === currentStep && currentStep !== 4
    })),
    currentTaskLabel: currentTask && currentTask.task || (order.status === 'cancelled' ? '订单已取消'
      : order.status === 'returned' ? '订单已退货'
        : order.status === 'delivered' ? '订单已送达'
          : order.status === 'shipped' ? '运输中 · 查看物流记录'
            : order.status === 'picking' || order.paymentStatus === 'paid' || order.paymentStatus === 'pending_credit' ? '商家正在备货'
              : order.status === 'confirmed' && order.paymentStatus === 'pending'
                ? order.paymentMethod === 'bank_transfer' ? '等待商家核实转账' : '付款处理中'
                : order.status === 'confirmed' ? '请完成付款' : '等待商家审核订单'),
    amount: Number(order.totalAmount || 0).toFixed(2),
    displayAmount: formatEurAmount(order.totalAmount) || ('€' + Number(order.totalAmount || 0).toFixed(2)),
    statusLabel: statusLabels[order.status] || order.status,
    paymentLabel: paymentLabels[order.paymentStatus] || order.paymentStatus,
    itemSummary: (order.items || []).map(item => {
      const supply = Number.isInteger(item.inStockQuantity) && Number.isInteger(item.preorderQuantity)
        ? `（现货 ${item.inStockQuantity} / 订货 ${item.preorderQuantity}）`
        : '';
      return `${item.productName} ${item.color || ''} / ${item.size || ''} × ${item.quantity}${supply}`;
    }).join('、'),
    canCancel: ['placed', 'pending', 'confirmed', 'picking'].includes(order.status)
  };
}

Page({
  data: {
    orders: [],
    visibleOrders: [],
    filter: 'all',
    filterLabel: '',
    loading: false,
    error: '',
    submitted: false,
    expandedOrderId: '',
    shipments: [],
    trackingLoading: false,
    trackingError: '',
    agreementDraft: null,
    agreementSaving: false,
    paymentOrderId: '',
    paymentReference: '',
    agreementPaymentPlanLabels: ['全额预付', '先发货后付款', '部分预付', '送达时付款', '自定义'],
    agreementPaymentMethodLabels: ['银行转账', '银行卡'],
    agreementBalanceTriggerLabels: ['发货前', '货到时', '送达后', '指定日期', '自定义条件'],
    agreementPrepaymentModeLabels: ['百分比', '欧元'],
    agreementSupplyModeLabels: ['现货优先', '齐货后发', '允许分批发货']
  },

  onLoad(options) {
    const filter = options && typeof options.filter === 'string' ? options.filter : 'all';
    const known = ORDER_FILTERS.some(item => item.key === filter);
    this.setData({
      submitted: Boolean(options && options.submitted),
      filter: known ? filter : 'all',
      filterLabel: known ? orderFilterLabel(filter) : ''
    });
  },

  onShow() {
    const session = getAuthSession();
    if (!session || session.role !== 'buyer') {
      wx.redirectTo({ url: '/pages/login/index?role=buyer' });
      return;
    }
    this.loadOrders();
  },

  async loadOrders() {
    this.setData({ loading: true, error: '' });
    try {
      const response = await getBuyerOrders();
      const orders = (response.orders || []).map(presentOrder);
      this.setData({
        orders,
        visibleOrders: filterBuyerOrders(orders, this.data.filter)
      });
    } catch (error) {
      this.setData({ error: error.message || '订单加载失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  clearFilter() {
    this.setData({
      filter: 'all',
      filterLabel: '',
      visibleOrders: filterBuyerOrders(this.data.orders, 'all')
    });
  },

  onPullDownRefresh() {
    this.loadOrders();
  },

  async toggleTracking(event) {
    const orderId = event.currentTarget.dataset.id;
    if (this.data.expandedOrderId === orderId) {
      this.setData({ expandedOrderId: '' });
      return;
    }
    this.setData({ expandedOrderId: orderId, shipments: [], trackingLoading: true, trackingError: '' });
    await this.loadShipments(orderId);
  },

  async loadShipments(orderId) {
    this.setData({ trackingLoading: true, trackingError: '' });
    try {
      const response = await getBuyerOrderShipments(orderId);
      if (this.data.expandedOrderId === orderId) {
        const statusLabels = {
          pending: '待发货',
          packed: '备货完成',
          shipped: '运输中',
          delivered: '已送达',
          exception: '物流异常',
          cancelled: '已取消'
        };
        this.setData({
          shipments: (response.shipments || []).map(shipment => ({
            ...shipment,
            statusLabel: statusLabels[shipment.status] || shipment.status
          }))
        });
      }
    } catch (error) {
      this.setData({ trackingError: error.message || '物流记录加载失败，请重试。' });
    } finally {
      this.setData({ trackingLoading: false });
    }
  },

  refreshTracking() {
    if (this.data.expandedOrderId) this.loadShipments(this.data.expandedOrderId);
  },

  async confirmAgreement(event) {
    const { id, agreementId, version } = event.currentTarget.dataset;
    if (!id || !agreementId) return;
    wx.showModal({
      title: '确认交易约定',
      content: `确认同意约定版本 ${version}？`,
      success: async result => {
        if (!result.confirm) return;
        try {
          await confirmBuyerOrderAgreement(id, agreementId);
          wx.showToast({ title: '约定已确认', icon: 'success' });
          await this.loadOrders();
        } catch (error) {
          wx.showToast({ title: error.message || '确认失败，请刷新重试', icon: 'none' });
        }
      }
    });
  },

  openCounterProposal(event) {
    const order = this.data.orders.find(item => item.id === event.currentTarget.dataset.id);
    const agreement = order && order.currentAgreement;
    if (!order || !agreement || agreement.status !== 'pending_buyer') return;
    this.setData({
      agreementDraft: {
        orderId: order.id,
        agreementId: agreement.id,
        sourceTerms: agreement.terms,
        paymentPlan: agreement.terms.paymentPlan,
        paymentPlanIndex: ['full_prepayment', 'ship_before_payment', 'partial_prepayment', 'cash_on_delivery', 'custom'].indexOf(agreement.terms.paymentPlan),
        paymentMethod: agreement.terms.paymentMethod,
        paymentMethodIndex: agreement.terms.paymentMethod === 'credit_card' || agreement.terms.paymentMethod === 'stripe' ? 1 : 0,
        prepaymentMode: 'percent',
        prepaymentValue: String(agreement.terms.totalAmount
          ? Number((agreement.terms.prepaymentAmount / agreement.terms.totalAmount * 100).toFixed(2))
          : 30),
        remainingBalanceTrigger: agreement.terms.remainingBalanceTrigger || 'before_shipment',
        remainingBalanceTriggerIndex: ['before_shipment', 'on_delivery', 'after_delivery', 'date', 'custom'].indexOf(agreement.terms.remainingBalanceTrigger || 'before_shipment'),
        remainingBalanceDueAt: agreement.terms.remainingBalanceDueAt || '',
        customPaymentCondition: agreement.terms.customPaymentCondition || '',
        expectedDeliveryAt: agreement.terms.expectedDeliveryAt || '',
        shippingFee: String(agreement.terms.shippingFee || 0),
        discountAmount: String(agreement.terms.discountAmount || 0),
        supplyMode: agreement.terms.supplyMode || 'partial_shipments',
        supplyModeIndex: ['in_stock_first', 'all_ready', 'partial_shipments'].indexOf(agreement.terms.supplyMode || 'partial_shipments'),
        items: agreement.terms.items.map(item => ({
          orderItemId: item.orderItemId,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice)
        }))
      }
    });
  },

  onAgreementDraftInput(event) {
    const { field, index } = event.currentTarget.dataset;
    if (!this.data.agreementDraft || !field) return;
    if (field === 'quantity' || field === 'unitPrice') {
      const items = this.data.agreementDraft.items.map((item, itemIndex) => itemIndex === Number(index)
        ? Object.assign({}, item, { [field]: event.detail.value })
        : item);
      this.setData({ 'agreementDraft.items': items });
      return;
    }
    this.setData({ [`agreementDraft.${field}`]: event.detail.value });
  },

  onAgreementPickerChange(event) {
    const { field } = event.currentTarget.dataset;
    const index = Number(event.detail.value);
    const values = {
      paymentPlan: ['full_prepayment', 'ship_before_payment', 'partial_prepayment', 'cash_on_delivery', 'custom'],
      paymentMethod: ['bank_transfer', 'credit_card'],
      remainingBalanceTrigger: ['before_shipment', 'on_delivery', 'after_delivery', 'date', 'custom'],
      supplyMode: ['in_stock_first', 'all_ready', 'partial_shipments']
    };
    if (!values[field] || !Number.isInteger(index)) return;
    const indexField = `${field}Index`;
    this.setData({
      [`agreementDraft.${field}`]: values[field][index],
      [`agreementDraft.${indexField}`]: index
    });
  },

  onPrepaymentModeChange(event) {
    const index = Number(event.detail.value);
    if (index !== 0 && index !== 1) return;
    this.setData({
      'agreementDraft.prepaymentMode': index === 1 ? 'amount' : 'percent'
    });
  },

  async submitCounterProposal() {
    const draft = this.data.agreementDraft;
    if (!draft || this.data.agreementSaving) return;
    const items = draft.items.map(item => ({
      orderItemId: item.orderItemId,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice)
    }));
    if (items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1
      || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0)) {
      wx.showToast({ title: '请检查商品数量和单价', icon: 'none' });
      return;
    }
    const { prepaymentAmount: ignoredPrepaymentAmount, ...sourceTerms } = draft.sourceTerms;
    const terms = {
      ...sourceTerms,
      paymentPlan: draft.paymentPlan,
      paymentMethod: draft.paymentMethod,
      supplyMode: draft.supplyMode,
      remainingBalanceTrigger: draft.remainingBalanceTrigger,
      remainingBalanceDueAt: draft.remainingBalanceDueAt || null,
      customPaymentCondition: draft.customPaymentCondition || null,
      expectedDeliveryAt: draft.expectedDeliveryAt || null,
      shippingFee: Number(draft.shippingFee),
      discountAmount: Number(draft.discountAmount),
      items
    };
    if (draft.paymentPlan === 'partial_prepayment') {
      if (draft.prepaymentMode === 'percent') terms.prepaymentPercent = Number(draft.prepaymentValue);
      else terms.prepaymentAmount = Number(draft.prepaymentValue);
    } else if (draft.paymentPlan === 'custom' && draft.prepaymentValue) {
      terms.prepaymentAmount = Number(draft.prepaymentValue);
    }
    this.setData({ agreementSaving: true });
    try {
      await proposeBuyerOrderAgreement(draft.orderId, draft.agreementId, terms);
      this.setData({ agreementDraft: null });
      wx.showToast({ title: '新方案已发送', icon: 'success' });
      await this.loadOrders();
    } catch (error) {
      wx.showToast({ title: error.message || '提交方案失败，请检查后重试', icon: 'none' });
    } finally {
      this.setData({ agreementSaving: false });
    }
  },

  closeCounterProposal() {
    if (!this.data.agreementSaving) this.setData({ agreementDraft: null });
  },

  openPayment(event) {
    const orderId = event.currentTarget.dataset.id;
    const order = this.data.orders.find(item => item.id === orderId);
    if (!order || !['pay', 'pay_balance'].includes(order.currentTasks && order.currentTasks.buyer.action)) return;
    const paymentMethod = order.currentAgreement && order.currentAgreement.terms.paymentMethod || order.paymentMethod;
    if (paymentMethod === 'bank_transfer' || paymentMethod === 'bank_transfer_prepay') {
      this.setData({ paymentOrderId: orderId, paymentReference: '' });
      return;
    }
    this.submitCardPayment(order);
  },

  onPaymentReferenceInput(event) {
    this.setData({ paymentReference: event.detail.value });
  },

  cancelPayment() {
    this.setData({ paymentOrderId: '', paymentReference: '' });
  },

  async submitBankTransfer() {
    const order = this.data.orders.find(item => item.id === this.data.paymentOrderId);
    const paymentReference = this.data.paymentReference.trim();
    if (!order || paymentReference.length < 2) {
      wx.showToast({ title: '请输入银行交易参考号', icon: 'none' });
      return;
    }
    if (this.data.paymentSaving) return;
    this.setData({ paymentSaving: true });
    try {
      await submitBuyerOrderPayment(order.id, order.currentAgreement && order.currentAgreement.terms.paymentMethod || order.paymentMethod, paymentReference);
      this.cancelPayment();
      wx.showToast({ title: '已登记，待商家核实到账', icon: 'success' });
      await this.loadOrders();
    } catch (error) {
      wx.showToast({ title: error.message || '转账登记失败，请刷新重试', icon: 'none' });
    } finally {
      this.setData({ paymentSaving: false });
    }
  },

  async submitCardPayment(order) {
    if (this.data.paymentSaving) return;
    this.setData({ paymentSaving: true });
    try {
      const result = await submitBuyerOrderPayment(order.id, 'credit_card');
      const checkoutUrl = result && result.payment && result.payment.checkoutUrl;
      if (typeof checkoutUrl === 'string' && checkoutUrl.length <= 2000 && /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(checkoutUrl)) {
        wx.navigateTo({ url: `/pages/webview/index?title=${encodeURIComponent('安全付款')}&url=${encodeURIComponent(checkoutUrl)}` });
        return;
      }
      wx.showToast({ title: '支付页面暂不可用，请刷新订单状态', icon: 'none' });
      await this.loadOrders();
    } catch (error) {
      wx.showToast({ title: error.message || '无法发起付款，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ paymentSaving: false });
    }
  },

  cancelOrder(event) {
    const orderId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '取消订单',
      content: '确认申请取消此订单？如果已付款，退款仍需按平台流程处理。',
      success: async result => {
        if (!result.confirm) return;
        try {
          await cancelBuyerOrder(orderId, '买家在小程序申请取消');
          wx.showToast({ title: '订单已取消', icon: 'success' });
          await this.loadOrders();
        } catch (error) {
          wx.showToast({ title: error.message || '取消失败，请稍后重试', icon: 'none' });
        }
      }
    });
  }
});
