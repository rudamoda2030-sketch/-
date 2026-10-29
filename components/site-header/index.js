Component({
  data: {
    statusBarHeight: 0,
    navBarHeight: 44
  },

  lifetimes: {
    attached() {
      const systemInfo = wx.getWindowInfo
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const statusBarHeight = Number(systemInfo.statusBarHeight) || 0;
      const menuButton = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      const navBarHeight = menuButton
        ? menuButton.height + (menuButton.top - statusBarHeight) * 2
        : 44;
      this.setData({
        statusBarHeight,
        navBarHeight
      });
    }
  },

  methods: {
    openSettings() {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      if (currentPage && currentPage.route === 'pages/settings/index') return;
      wx.navigateTo({ url: '/pages/settings/index' });
    }
  }
});
