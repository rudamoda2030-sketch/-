App({
  onHide() {
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    if (currentPage && typeof currentPage.onAppBackground === 'function') {
      currentPage.onAppBackground();
    }
  },
  onShow() {
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    if (currentPage && typeof currentPage.onAppForeground === 'function') {
      currentPage.onAppForeground();
    }
  }
});
