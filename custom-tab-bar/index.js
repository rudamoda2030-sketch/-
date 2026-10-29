const { isFashionEnabled, isModauiEnabled, refreshModuleFlags } = require('../utils/module-flags');

// 平台全局开关（fashion_enabled / modaui_enabled）关闭时隐藏对应 tab。
// 本地副本只负责隐藏入口，服务端仍会按权威值拒绝请求。
const ALL_TABS = [
  { index: 0, pagePath: '/pages/home/index', text: '首页', icon: '' },
  { index: 1, pagePath: '/pages/merchants/index', text: '商家', icon: '' },
  { index: 2, pagePath: '/pages/modagpt/index', text: 'ModaUI', icon: '✦' },
  { index: 3, pagePath: '/pages/fashion/index', text: '时尚', icon: '' },
  { index: 4, pagePath: '/pages/profile/index', text: '我的', icon: '' }
];

function buildTabs() {
  return ALL_TABS.filter(function (tab) {
    if (tab.pagePath === '/pages/fashion/index') return isFashionEnabled();
    if (tab.pagePath === '/pages/modagpt/index') return isModauiEnabled();
    return true;
  });
}

function applyTabs(component) {
  refreshModuleFlags().then(function () {
    component.setData({ tabs: buildTabs() });
  });
}

Component({
  data: {
    selected: 0,
    tabs: buildTabs()
  },

  lifetimes: {
    attached() {
      applyTabs(this);
    }
  },

  pageLifetimes: {
    show() {
      applyTabs(this);
    }
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = buildTabs().find(item => item.index === index);
      if (!tab) return;
      this.setData({ selected: index });
      wx.switchTab({ url: tab.pagePath });
    },

    onFashionShortcut(event) {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      if (page && typeof page.onFashionShortcut === 'function') {
        page.onFashionShortcut({
          currentTarget: {
            dataset: { key: event.currentTarget.dataset.key }
          }
        });
      }
    }
  }
});
