// 「我的」订单速览与订单页筛选共用的展示口径。
// 只把服务端返回的 status / paymentStatus / currentTasks.buyer.action 映射为
// 买家可读的分组，不产生新的订单状态，也不替代服务端判断。
const CLOSED_STATUSES = ['cancelled', 'returned'];

const ORDER_FILTERS = [
  { key: 'all', label: '全部订单' },
  { key: 'pendingPayment', label: '待付款' },
  { key: 'toShip', label: '待发货' },
  { key: 'shipping', label: '运输中' },
  { key: 'afterSales', label: '售后服务' }
];

function buyerTaskAction(order) {
  const tasks = order && order.currentTasks;
  const buyer = tasks && tasks.buyer;
  return buyer && typeof buyer.action === 'string' ? buyer.action : '';
}

function needsPayment(order) {
  if (!order || CLOSED_STATUSES.indexOf(order.status) >= 0) return false;
  const action = buyerTaskAction(order);
  if (action === 'pay' || action === 'pay_balance') return true;
  if (['unpaid', 'payment_required', 'payment_failed'].indexOf(order.paymentStatus) < 0) return false;
  return order.status !== 'delivered';
}

function matchesOrderFilter(order, key) {
  if (!order) return false;
  if (key === 'pendingPayment') return needsPayment(order);
  if (key === 'toShip') return ['confirmed', 'picking'].indexOf(order.status) >= 0;
  if (key === 'shipping') return order.status === 'shipped';
  if (key === 'afterSales') return order.status === 'returned';
  return true;
}

function summarizeBuyerOrders(orders) {
  if (!Array.isArray(orders)) return null;
  const summary = { total: orders.length, pendingPayment: 0, toShip: 0, shipping: 0, afterSales: 0 };
  orders.forEach(function (order) {
    ['pendingPayment', 'toShip', 'shipping', 'afterSales'].forEach(function (key) {
      if (matchesOrderFilter(order, key)) summary[key] += 1;
    });
  });
  return summary;
}

function filterBuyerOrders(orders, key) {
  if (!Array.isArray(orders)) return [];
  if (!key || key === 'all') return orders.slice();
  return orders.filter(function (order) { return matchesOrderFilter(order, key); });
}

function orderFilterLabel(key) {
  const filter = ORDER_FILTERS.find(function (item) { return item.key === key; });
  return filter ? filter.label : '';
}

// 授权码找店：只接受服务端真实支持的 6 位商家编号。
function normalizeStoreCode(value) {
  const code = String(value === undefined || value === null ? '' : value).replace(/\s+/g, '');
  if (!code) return { code: '', error: '请输入商家提供的授权码' };
  if (!/^\d{6}$/.test(code)) return { code: '', error: '授权码为 6 位数字，请核对后重试' };
  return { code: code, error: '' };
}

module.exports = {
  ORDER_FILTERS,
  summarizeBuyerOrders,
  filterBuyerOrders,
  orderFilterLabel,
  matchesOrderFilter,
  normalizeStoreCode
};
