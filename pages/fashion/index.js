const {
  activateFashionAccount,
  addFashionComment,
  deleteFashionComment,
  deleteFashionNotification,
  followFashionCreator,
  getAssetUrl,
  getFashionComments,
  getFashionCreatorProfile,
  getFashionEditorial,
  getFashionNotifications,
  getFashionTags,
  getFashionTaxonomy,
  markFashionNotificationsRead,
  getFashionMerchants,
  getFashionPosts,
  getFashionSocial,
  getFashionDrafts,
  createFashionDraft,
  updateFashionDraft,
  deleteFashionDraft,
  getProduct,
  hideFashionPost,
  blockFashionCreator,
  unblockFashionCreator,
  getFashionAnalytics,
  deleteFashionPost,
  getProducts,
  reactFashionPost,
  recordFashionPostView,
  recordFashionProductClick,
  reportFashionContent,
  searchFashionCreatorProducts,
  translateFashionText,
  uploadFashionPostAsset,
  submitFashionMixedPost
} = require('../../utils/api');
const { getAuthSession } = require('../../utils/auth');
const { API_BASE_URL } = require('../../utils/constants');
const { isFashionEnabled, refreshModuleFlags } = require('../../utils/module-flags');

const fashionCategories = ['女装趋势', '男装趋势', '鞋履趋势', '包袋配饰', '面料与针织', '秀场街拍'];
const categories = ['全部'].concat(fashionCategories);
const postCategories = fashionCategories.slice();
const categoryFilters = fashionCategories.reduce((map, category) => {
  map[category] = category;
  return map;
}, {});
const cities = ['全部地区', 'Prato', 'Milano', 'Firenze', 'Roma', 'Torino', 'Bologna', 'Venezia', 'Napoli'];
const cityLabels = ['全部地区', '普拉托', '米兰', '佛罗伦萨', '罗马', '都灵', '博洛尼亚', '威尼斯', '那不勒斯'];
const fashionSeasons = ['春季', '夏季', '秋季', '冬季'];
const seasonOptions = ['不限季节'].concat(fashionSeasons);
const postVisibilityValues = ['public', 'followers', 'private'];
const postVisibilityOptions = ['公开', '关注者', '仅自己'];
const popularCities = ['Prato', 'Milano', 'Firenze', 'Roma', 'Torino', 'Bologna', 'Venezia', 'Napoli'];
const citySections = Array.from(popularCities.reduce((groups, city) => {
  const letter = city[0].toUpperCase();
  if (!groups.has(letter)) groups.set(letter, []);
  groups.get(letter).push(city);
  return groups;
}, new Map()), ([letter, names]) => ({ letter, names }));
const MAX_POST_MEDIA_COUNT = 8;
const MAX_POST_MEDIA_FILE_BYTES = 20 * 1024 * 1024;
const MAX_POST_MEDIA_TOTAL_BYTES = 50 * 1024 * 1024;
const FASHION_DRAFT_STORAGE_KEY = 'ruda_fashion_composer_draft';
const FASHION_DISMISSED_STORAGE_PREFIX = 'ruda_fashion_dismissed_';
const FASHION_DISMISSED_LIMIT = 200;
const FASHION_SHARE_PATH = '/trends';
const modes = [
  { id: 'prato', label: '普拉托' },
  { id: 'following', label: '关注' },
  { id: 'shop', label: '商城' },
  { id: 'featured', label: '推荐' }
];
function createIdempotencyKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 3) | 8).toString(16);
  });
}

function getSelectedMediaInfo(file) {
  const filePath = String(file && file.tempFilePath || '');
  const name = filePath.split('/').pop() || '';
  const extension = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  const extensionType = {
    jpg: 'image',
    jpeg: 'image',
    png: 'image',
    webp: 'image',
    mp4: 'video',
    mov: 'video',
    webm: 'video'
  }[String(extension || '').toLowerCase()];
  const type = file && file.fileType === 'video' ? 'video' : file && file.fileType === 'image' ? 'image' : extensionType;
  if (!filePath || !type || !extensionType || type !== extensionType) return null;
  return {
    type,
    name,
    filePath,
    posterPath: type === 'video' ? String(file.thumbTempFilePath || '') : '',
    size: Number(file.size || 0),
    duration: Number(file.duration || 0)
  };
}

function getLocalFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath,
      success: result => resolve(Number(result.size || 0)),
      fail: () => reject(new Error('FASHION_MEDIA_FILE_INFO_FAILED'))
    });
  });
}

function savePersistentFile(filePath) {
  const userDataPath = wx.env && wx.env.USER_DATA_PATH;
  if (userDataPath && filePath.indexOf(userDataPath + '/') === 0) return Promise.resolve(filePath);
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath: filePath,
      success: result => {
        if (typeof result.savedFilePath !== 'string' || !result.savedFilePath) {
          reject(new Error('FASHION_DRAFT_FILE_SAVE_FAILED'));
          return;
        }
        resolve(result.savedFilePath);
      },
      fail: () => reject(new Error('FASHION_DRAFT_FILE_SAVE_FAILED'))
    });
  });
}

function formatMediaSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatMediaDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function getBaseName(filePath) {
  return String(filePath || '').split('/').pop() || '';
}

function formatDraftTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '刚刚更新';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function buildRemoteDraftMedia(mediaItems) {
  return (Array.isArray(mediaItems) ? mediaItems : []).map((media, index) => {
    const type = media && media.type === 'video' ? 'video' : 'image';
    return {
      id: `remote-${index}`,
      type,
      name: '',
      filePath: '',
      posterPath: '',
      posterToken: media && typeof media.posterToken === 'string' ? media.posterToken : '',
      uploadToken: media && typeof media.uploadToken === 'string' ? media.uploadToken : '',
      size: 1,
      posterSize: type === 'video' ? 1 : 0,
      sizeLabel: '云端素材',
      duration: 0,
      durationLabel: '',
      trimStartSeconds: 0,
      trimEndSeconds: 0,
      muted: false,
      filePersistent: true,
      posterPersistent: true,
      remote: true
    };
  }).filter(media => media.uploadToken);
}

function createViewerId() {
  const key = 'ruda_fashion_viewer_id';
  const current = wx.getStorageSync(key);
  if (typeof current === 'string' && /^[a-f0-9-]{36}$/i.test(current)) return current;
  const value = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 3) | 8).toString(16);
  });
  wx.setStorageSync(key, value);
  return value;
}

function presentPost(post) {
  const mediaItems = (Array.isArray(post.mediaItems) ? post.mediaItems : []).map(item => Object.assign({}, item, {
    url: getAssetUrl(item.url),
    posterUrl: getAssetUrl(item.posterUrl)
  }));
  const media = mediaItems.length ? mediaItems[0] : null;
  const videoMedia = mediaItems.find(item => item.type === 'video');
  const imageMedia = mediaItems.find(item => item.type === 'image');
  const coverIndex = Number.isInteger(post.coverMediaIndex) && post.coverMediaIndex >= 0 && post.coverMediaIndex < mediaItems.length
    ? post.coverMediaIndex
    : 0;
  const coverMedia = mediaItems[coverIndex];
  const image = coverMedia
    ? (coverMedia.type === 'image' ? coverMedia.url : coverMedia.posterUrl || post.image)
    : imageMedia ? imageMedia.url : media && media.posterUrl ? media.posterUrl : post.image;
  const video = videoMedia ? videoMedia.url : post.videoUrl;
  const poster = videoMedia && videoMedia.posterUrl ? videoMedia.posterUrl : image;
  return Object.assign({}, post, {
    products: (Array.isArray(post.products) ? post.products : []).map(product => Object.assign({}, product, {
      coverUrl: getAssetUrl(product.image),
      displayPrice: product.retailPrice ? `€${Number(product.retailPrice).toFixed(0)}` : '',
      displayName: product.name || product.styleNo || '时尚商品'
    })),
    mediaItems: mediaItems.length ? mediaItems : (video ? [{
      type: 'video',
      url: getAssetUrl(video),
      posterUrl: getAssetUrl(poster)
    }] : image ? [{ type: 'image', url: getAssetUrl(image) }] : []),
    imageUrl: getAssetUrl(image),
    coverMediaIndex: coverIndex,
    videoUrl: getAssetUrl(video),
    videoPoster: getAssetUrl(poster),
    mediaCount: mediaItems.length || (video || image ? 1 : 0),
    hasVideo: Boolean(video),
    creatorId: post.creatorAccountId || '',
    creatorAvatarUrl: getAssetUrl(post.creatorAvatarUrl),
    displayCreator: post.creatorName || 'RUDA 时尚社区',
    creatorInitial: (post.creatorName || 'RUDA')[0],
    displayTitle: post.title || 'RUDA Fashion',
    socialEnabled: post.socialEnabled === true || Boolean(post.creatorAccountId) || String(post.id || '').indexOf('fashion-post-') === 0
  });
}

function buildMagazineColumns(items) {
  const columns = [[], []];
  const heights = [0, 0];
  items.forEach((post, index) => {
    const media = post.mediaItems[0] || {};
    const width = Number(media.width || post.coverWidth);
    const height = Number(media.height || post.coverHeight);
    const ratio = width > 0 && height > 0
      ? Math.max(0.95, Math.min(1.55, height / width))
      : post.hasVideo ? 1.42 : [1.18, 1.38, 1.08][index % 3];
    const coverHeight = Math.round(336 * ratio);
    const tile = Object.assign({}, post, { magazineCoverHeight: coverHeight });
    const columnIndex = heights[0] <= heights[1] ? 0 : 1;
    columns[columnIndex].push(tile);
    heights[columnIndex] += coverHeight + 142;
  });
  return columns;
}

Page({
  data: {
    featureEnabled: true,
    browseView: 'grid',
    magazineColumns: [[], []],
    magazineScrollTop: 0,
    statusBarHeight: 20,
    items: [],
    visibleItems: [],
    merchants: [],
    modes,
    mode: 'featured',
    activeFeedIndex: 0,
    activePostId: '',
    galleryIndices: {},
    pageVisible: false,
    videoPlaying: false,
    videoLoading: false,
    videoMuted: true,
    videoFailed: false,
    videoRetrying: false,
    mediaLoadErrors: {},
    videoProgress: 0,
    translations: {},
    translationVisible: {},
    translationPending: {},
    dismissedIds: [],
    notificationsOpen: false,
    notifications: [],
    notificationsLoading: false,
    notificationUnread: 0,
    discoverTags: [],
    mediaActionsItem: null,
    categories,
    postCategories,
    categoryIndex: 0,
    cities,
    cityLabels,
    cityIndex: 0,
    seasonOptions,
    seasonIndex: 0,
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: '',
    social: {},
    viewerId: '',
    commentPost: null,
    comments: [],
    commentDraft: '',
    commentsLoading: false,
    commentsError: '',
    commentSubmitting: false,
    replyTarget: null,
    commentsHasMore: false,
    creatorProfileOpen: false,
    creatorProfileLoading: false,
    creatorProfileError: '',
    creatorProfile: null,
    creatorProfileColumns: [[], []],
    cityPickerOpen: false,
    citySearch: '',
    citySectionTarget: '',
    filteredCities: popularCities,
    citySections,
    cityAlphabet: citySections.map(section => section.letter),
    searchOpen: false,
    searchQuery: '',
    searchSubmitted: false,
    searchResults: [],
    searchLoading: false,
    searchError: '',
    searchHasMore: false,
    composerOpen: false,
    composerStep: 'capture',
    publicationResult: null,
    draftMedia: [],
    activeMediaIndex: 0,
    coverMediaIndex: 0,
    postTitle: '',
    postText: '',
    postHashtags: [],
    hashtagDraft: '',
    postCategoryIndex: 0,
    postCityIndex: cities.indexOf('Prato'),
    postSeasonIndex: 0,
    postVisibilityValues,
    postVisibilityOptions,
    postVisibilityIndex: 0,
    commentsEnabled: true,
    selectedProduct: null,
    productPickerOpen: false,
    productSearch: '',
    productResults: [],
    productSearchLoading: false,
    productSearchError: '',
    rightsConfirmed: false,
    postSubmitting: false,
    uploadProgress: 0,
    uploadCurrentLabel: '',
    uploadError: '',
    draftSaving: false,
    draftRestoreWarning: '',
    serverDrafts: [],
    serverDraftsLoading: false,
    serverDraftsError: '',
    serverDraftsSignedOut: false,
    analyticsOpen: false,
    analyticsLoading: false,
    analyticsError: '',
    analyticsTotals: null,
    analyticsPosts: [],
  },

  onLoad(options) {
    let systemInfo = {};
    try {
      systemInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (error) {
      console.warn('[mini-fashion-system-info]', error);
    }
    const windowHeight = Number(systemInfo.windowHeight || systemInfo.screenHeight) || 844;
    const statusBarHeight = Number(systemInfo.statusBarHeight) || 20;
    const safeAreaBottom = systemInfo.safeArea && Number.isFinite(Number(systemInfo.safeArea.bottom))
      ? Math.max(0, windowHeight - Number(systemInfo.safeArea.bottom))
      : 0;
    const feedBottomOffset = safeAreaBottom + 66;
    const menuButton = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    const menuLeft = Number(menuButton && menuButton.left);
    const capsuleRight = Number.isFinite(menuLeft) && menuLeft > 0
      ? Math.max(0, Number(systemInfo.windowWidth || 390) - menuLeft)
      : 0;
    const searchRight = capsuleRight ? capsuleRight + 8 : 12;
    this._offset = 0;
    this._cursor = '';
    this._feedRequestGeneration = 0;
    this._requestedPostId = options && typeof options.postId === 'string' ? options.postId : '';
    this._editorialLoaded = false;
    this._editorials = [];
    this._socialLocks = new Set();
    this._playbackGeneration = 0;
    this.setData({
      browseView: this._requestedPostId ? 'feed' : 'grid',
      viewerId: createViewerId(),
      statusBarHeight,
      windowHeight,
      safeAreaBottom,
      searchRight,
      feedNavRight: searchRight + 44,
      topNavigationTop: statusBarHeight + 8,
      feedBottomOffset
    });
    this.restoreComposerDraft();
    this.restoreDismissedItems();
    this.loadTaxonomy();
    this.loadFeed(true);
  },

  // Admin-managed categories must reach the mini program without a release. The
  // static list stays as the fallback when taxonomy is unavailable.
  async loadTaxonomy() {
    try {
      const result = await getFashionTaxonomy();
      const names = (result.categories || []).map(item => item.name).filter(Boolean);
      if (!names.length) return;
      const filters = names.reduce((map, name) => { map[name] = name; return map; }, {});
      this._taxonomyCategoryFilters = filters;
      const postCategoryIndex = names.indexOf((this.data.postCategories || [])[this.data.postCategoryIndex] || '');
      this.setData({
        categories: ['全部'].concat(names),
        postCategories: names,
        postCategoryIndex: postCategoryIndex >= 0 ? postCategoryIndex : 0
      });
    } catch (error) {
      console.warn('[mini-fashion-taxonomy]', error);
    }
  },

  onResize(event) {
    let systemInfo = {};
    try {
      systemInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (error) {
      console.warn('[mini-fashion-window-resize]', error);
    }
    const windowHeight = Number(event && event.size && event.size.windowHeight
      || systemInfo.windowHeight || systemInfo.screenHeight || this.data.windowHeight);
    const safeAreaBottom = systemInfo.safeArea && Number.isFinite(Number(systemInfo.safeArea.bottom))
      ? Math.max(0, windowHeight - Number(systemInfo.safeArea.bottom))
      : this.data.safeAreaBottom;
    const statusBarHeight = Number(systemInfo.statusBarHeight) || this.data.statusBarHeight;
    const windowWidth = Number(systemInfo.windowWidth) || 390;
    const menuButton = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    const menuLeft = Number(menuButton && menuButton.left);
    const capsuleRight = Number.isFinite(menuLeft) && menuLeft > 0 ? Math.max(0, windowWidth - menuLeft) : 0;
    const searchRight = capsuleRight ? capsuleRight + 8 : 12;
    this.setData({
      windowHeight,
      safeAreaBottom,
      statusBarHeight,
      searchRight,
      feedNavRight: searchRight + 44,
      topNavigationTop: statusBarHeight + 8,
      feedBottomOffset: safeAreaBottom + 66
    });
  },

  onShow() {
    if (!isFashionEnabled()) {
      // 本地副本可能过期：强制刷新一次后再决定是否离开，服务端 403 仍是最终拦截。
      refreshModuleFlags({ force: true }).then(function () {
        if (isFashionEnabled()) return;
        wx.showToast({ title: '该功能暂未开放', icon: 'none' });
        wx.switchTab({ url: '/pages/home/index' });
      });
      return;
    }
    let requestedPostId = '';
    let openComposer = false;
    try {
      requestedPostId = String(wx.getStorageSync('ruda_fashion_requested_post_id') || '');
      openComposer = Boolean(wx.getStorageSync('ruda_fashion_open_composer'));
      if (requestedPostId) wx.removeStorageSync('ruda_fashion_requested_post_id');
      if (openComposer) wx.removeStorageSync('ruda_fashion_open_composer');
    } catch (error) {
      console.warn('[mini-fashion-pending-navigation]', error);
    }
    if (requestedPostId) {
      this._requestedPostId = requestedPostId;
      this.setData({ browseView: 'feed', mode: 'featured', categoryIndex: 0, cityIndex: 0 });
    }
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({
      selected: 3,
      fashionImmersive: this.data.browseView === 'feed'
    });
    this.refreshFashionNotificationCount();
    this.loadDiscoverTags();
    this.loadServerDrafts();
    this.setData({ pageVisible: true }, () => {
      if (requestedPostId) {
        this.loadFeed(true);
      } else {
        this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
        this.resumeFeedVideo();
      }
      if (openComposer) this.openComposer();
    });
  },

  onHide() {
    this.pauseActiveVideo();
    this.setData({ pageVisible: false, videoPlaying: false }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  onUnload() {
    this._playbackGeneration += 1;
    this._productSearchRequest = (this._productSearchRequest || 0) + 1;
    if (this._productSearchTimer) clearTimeout(this._productSearchTimer);
    this.persistDraftWhenFilesReady();
    this.setData({ pageVisible: false });
    if (this._videoContextReady) wx.createVideoContext('fashion-active-video', this).pause();
    this._videoContextReady = false;
  },

  onAppBackground() {
    this.pauseActiveVideo();
    this.setData({ pageVisible: false }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  onAppForeground() {
    this.setData({ pageVisible: true }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
      this.resumeFeedVideo();
    });
  },

  pauseActiveVideo() {
    this._playbackGeneration += 1;
    if (this._videoContextReady) wx.createVideoContext('fashion-active-video', this).pause();
    this.setData({ videoPlaying: false, videoLoading: false });
  },

  playActiveVideo() {
    const active = this.data.visibleItems[this.data.activeFeedIndex];
    const generation = ++this._playbackGeneration;
    if (this.data.browseView !== 'feed' || !this.data.pageVisible || this.data.commentPost || this.data.composerOpen || this.data.searchOpen || this.data.cityPickerOpen || this.data.creatorProfileOpen
      || !active || !active.currentMedia || active.currentMedia.type !== 'video') {
      if (this._videoContextReady) wx.createVideoContext('fashion-active-video', this).pause();
      this._videoContextReady = false;
      this.setData({ videoPlaying: false });
      return;
    }
    const postId = active.id;
    wx.nextTick(() => {
      const current = this.data.visibleItems[this.data.activeFeedIndex];
      if (generation !== this._playbackGeneration || !this.data.pageVisible || this.data.commentPost
        || this.data.composerOpen || this.data.searchOpen || this.data.cityPickerOpen || this.data.creatorProfileOpen || this.data.activePostId !== postId
        || !current || !current.currentMedia || current.currentMedia.type !== 'video') return;
      this._videoContextReady = true;
      this.setData({ videoLoading: true });
      wx.createVideoContext('fashion-active-video', this).play();
    });
  },

  resumeFeedVideo() {
    this.playActiveVideo();
  },

  async ensureAccount() {
    const session = getAuthSession();
    if (!session) {
      wx.showModal({
        title: '登录后继续',
        content: '登录 RUDA 账号后即可关注、收藏和发布时尚内容。',
        confirmText: '去登录',
        success: result => { if (result.confirm) wx.navigateTo({ url: '/pages/login/index?role=buyer' }); }
      });
      return false;
    }
    try {
      await activateFashionAccount();
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || '账户验证失败', icon: 'none' });
      return false;
    }
  },

  async loadSocial(items) {
    const ids = [];
    items.forEach(item => {
      if (item.socialEnabled && item.id) ids.push(item.id);
      if (item.creatorId) ids.push(item.creatorId);
    });
    const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
    if (!uniqueIds.length) return {};
    const response = await getFashionSocial(uniqueIds, this.data.viewerId);
    return response.items || {};
  },

  refreshVisibleItems(items, social, mode) {
    this._visibleMode = mode;
    let visible = items;
    if (mode === 'videos') visible = items.filter(item => item.hasVideo);
    if (this.data.dismissedIds.length) {
      const dismissed = new Set(this.data.dismissedIds);
      visible = visible.filter(item => !dismissed.has(item.id));
    }
    const activeIndex = Math.max(0, Math.min(this.data.activeFeedIndex, Math.max(visible.length - 1, 0)));
    const activeItem = visible[activeIndex];
    const galleryIndices = this.data.galleryIndices || {};
    const activeMediaIndex = activeItem
      ? Math.max(0, Math.min(galleryIndices[activeItem.id] || 0, Math.max(activeItem.mediaItems.length - 1, 0)))
      : 0;
    const activeMedia = activeItem && activeItem.mediaItems[activeMediaIndex];
    const activeMediaKey = activeMedia ? `${activeItem.id}:${activeMediaIndex}:${activeMedia.url}` : '';
    const activeMediaChanged = activeMediaKey !== this._activeMediaKey;
    this._activeMediaKey = activeMediaKey;
    if (activeMediaChanged) {
      this._playbackGeneration += 1;
      if (this._videoContextReady) wx.createVideoContext('fashion-active-video', this).pause();
      this._videoContextReady = false;
    }
    visible = visible.map((item, index) => {
      const mediaIndex = Math.max(0, Math.min(galleryIndices[item.id] || 0, Math.max(item.mediaItems.length - 1, 0)));
      const mediaItems = item.mediaItems.map((media, itemIndex) => Object.assign({}, media, {
      imageFailed: Boolean(this.data.mediaLoadErrors[`${item.id}:${itemIndex}`])
      }));
      const currentMedia = mediaItems[mediaIndex];
      return Object.assign({}, item, {
      mediaIndex,
      mediaItems,
      currentMedia,
      isActive: index === activeIndex,
      showVideo: Boolean(this.data.browseView === 'feed' && this.data.pageVisible && !this.data.commentPost && !this.data.composerOpen
        && !this.data.searchOpen && !this.data.cityPickerOpen && !this.data.creatorProfileOpen && !this.data.mediaActionsItem
        && index === activeIndex && currentMedia && currentMedia.type === 'video'),
      interaction: social[item.id] || {},
      creatorInteraction: social[item.creatorId] || {},
      translation: this.data.translations[item.id] || '',
      translationVisible: Boolean(this.data.translations[item.id] && this.data.translationVisible[item.id]),
      translationPending: Boolean(this.data.translationPending[item.id]),
    });
    });
    if (this.data.browseView !== 'feed' || !this.data.pageVisible || this.data.commentPost || this.data.composerOpen || this.data.searchOpen
      || this.data.cityPickerOpen || this.data.creatorProfileOpen || this.data.mediaActionsItem || !activeMedia || activeMedia.type !== 'video') {
      if (this._videoContextReady) wx.createVideoContext('fashion-active-video', this).pause();
      this._videoContextReady = false;
    }
    this.setData({
      visibleItems: visible,
      activeFeedIndex: activeIndex,
      activePostId: activeItem ? activeItem.id : '',
      videoProgress: activeMediaChanged ? 0 : this.data.videoProgress,
      videoFailed: activeMediaChanged ? false : this.data.videoFailed,
      videoPlaying: activeMediaChanged ? false : Boolean(this.data.videoPlaying && this.data.pageVisible
        && !this.data.commentPost && !this.data.composerOpen && !this.data.searchOpen && !this.data.cityPickerOpen && !this.data.creatorProfileOpen),
      videoLoading: activeMediaChanged || !this.data.pageVisible || this.data.commentPost || this.data.composerOpen
        || this.data.searchOpen || this.data.cityPickerOpen || this.data.creatorProfileOpen ? false : this.data.videoLoading
    }, () => {
      if (activeMediaChanged && this.data.pageVisible && !this.data.commentPost && !this.data.composerOpen
        && !this.data.searchOpen && !this.data.cityPickerOpen && !this.data.creatorProfileOpen) {
        this.playActiveVideo();
      }
    });
  },

  async loadFeed(reset) {
    if (reset) this._feedRequestGeneration += 1;
    const generation = this._feedRequestGeneration || 0;
    if (this.data.loading || this.data.loadingMore) {
      if (reset) this._pendingFeedReset = true;
      if (reset) wx.stopPullDownRefresh();
      return;
    }
    this.setData({ loading: Boolean(reset), loadingMore: !reset, error: '' });
    if (reset) {
      this.pauseActiveVideo();
      this._offset = 0;
      this._cursor = '';
      this._activeMediaKey = '';
      this.setData({ items: [], visibleItems: [], activeFeedIndex: 0, activePostId: '' });
    }
    try {
      if (this.data.mode === 'merchants') {
        const result = await getFashionMerchants();
        if (generation !== this._feedRequestGeneration) return;
        const merchants = (result.merchants || []).map(merchant => Object.assign({}, merchant, {
          coverUrl: getAssetUrl(merchant.banner || merchant.showroomImage || merchant.logo),
          logoUrl: getAssetUrl(merchant.logo)
        }));
        this.setData({ merchants, hasMore: false, loading: false, loadingMore: false });
        wx.stopPullDownRefresh();
        return;
      }
      const categoryList = this.data.categories || categories;
      const filterMap = this._taxonomyCategoryFilters || categoryFilters;
      const categoryLabel = categoryList[this.data.categoryIndex];
      const category = categoryLabel === '全部' ? '' : (filterMap[categoryLabel] || categoryLabel);
      const cityIndex = this.data.mode === 'prato'
        ? (this.data.cityIndex === 0 ? cities.indexOf('Prato') : this.data.cityIndex)
        : 0;
      const city = cities[cityIndex];
      const query = {
        sort: this.data.mode === 'latest' ? 'latest' : 'recommended',
        limit: this._requestedPostId ? 1 : 24,
        offset: this._offset,
        cursor: this._cursor || undefined,
        postId: this._requestedPostId || undefined,
        saved: this.data.mode === 'saved' ? 'true' : undefined,
        following: this.data.mode === 'following' ? 'true' : undefined,
        category: category || undefined,
        season: this.data.seasonIndex > 0 ? fashionSeasons[this.data.seasonIndex - 1] : undefined,
        city: city === '全部地区' ? undefined : city
      };
      const result = await getFashionPosts(query);
      if (generation !== this._feedRequestGeneration) return;
      const nextItems = (result.posts || []).map(presentPost);
      const existing = new Set((reset ? [] : this.data.items).map(item => item.id));
      const items = (reset ? [] : this.data.items).concat(nextItems.filter(item => !existing.has(item.id)));
      let social = this.data.social;
      try {
        social = Object.assign({}, social, await this.loadSocial(nextItems));
      } catch (error) {
        console.error('[mini-fashion-social]', error);
      }
      if (generation !== this._feedRequestGeneration) return;
      if (reset && !this._requestedPostId && this.data.mode === 'featured' && this.data.categoryIndex === 0) {
        if (!this._editorialLoaded) {
          try {
            const editorial = await getFashionEditorial();
            this._editorials = (editorial.items || []).map(item => presentPost(Object.assign({}, item, {
              id: item.id,
              mediaType: 'image',
              creatorAccountId: '',
              creatorName: item.sourceName,
              socialEnabled: false
            })));
            this._editorialLoaded = true;
          } catch (error) {
            console.error('[mini-fashion-editorial]', error);
            this._editorialLoaded = true;
          }
        }
        if (generation !== this._feedRequestGeneration) return;
        items.unshift.apply(items, this._editorials);
      }
      if (reset && this._requestedPostId) {
        const requestedIndex = items.findIndex(item => item.id === this._requestedPostId);
        if (requestedIndex >= 0) this.setData({ activeFeedIndex: requestedIndex });
        else wx.showToast({ title: '该作品暂不可见或已下架', icon: 'none' });
        this._requestedPostId = '';
      }
      this._offset += nextItems.length;
      this._cursor = result.nextCursor || '';
      this.setData({
        items,
        magazineColumns: buildMagazineColumns(items),
        social,
        hasMore: Boolean(result.hasMore && nextItems.length),
        loading: false,
        loadingMore: false
      });
      this.refreshVisibleItems(items, social, this.data.mode);
      wx.stopPullDownRefresh();
    } catch (error) {
      if (generation !== this._feedRequestGeneration) return;
      console.error('[mini-fashion-feed]', error);
      this.setData({ error: error.message || '时尚内容暂时无法加载，请稍后重试。', loading: false, loadingMore: false });
      wx.stopPullDownRefresh();
    } finally {
      if (generation !== this._feedRequestGeneration) {
        this.setData({ loading: false, loadingMore: false }, () => {
          if (!this._pendingFeedReset) return;
          this._pendingFeedReset = false;
          this.loadFeed(true);
        });
      } else if (this._pendingFeedReset) {
        this._pendingFeedReset = false;
        this.loadFeed(true);
      }
    }
  },

  onMagazineScroll(event) {
    this._magazineScrollTop = Number(event.detail.scrollTop || 0);
  },

  onReachBottom() {
    if (this.data.browseView === 'grid' && this.data.hasMore) this.loadFeed(false);
  },

  loadMagazineMore() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadFeed(false);
  },

  openMagazinePost(event) {
    const postId = String(event.currentTarget.dataset.id || '');
    const activeFeedIndex = this.data.visibleItems.findIndex(item => item.id === postId);
    if (activeFeedIndex < 0) return;
    this.pauseActiveVideo();
    this._activeMediaKey = '';
    this.setData({
      browseView: 'feed',
      activeFeedIndex,
      videoFailed: false,
      videoPlaying: false,
      videoLoading: false
    }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: true });
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  returnToMagazine() {
    this.pauseActiveVideo();
    this._activeMediaKey = '';
    this.setData({ browseView: 'grid', magazineScrollTop: Number(this._magazineScrollTop || 0) }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: false });
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  onFeedSwiperChange(event) {
    const current = Number(event.detail.current);
    if (!Number.isInteger(current) || current < 0 || current >= this.data.visibleItems.length
      || current === this.data.activeFeedIndex) return;
    this.pauseActiveVideo();
    this._loadMoreAt = -1;
    this.setData({ activeFeedIndex: current, videoFailed: false, videoPlaying: false, videoLoading: false }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
      if (this.data.hasMore && current >= this.data.visibleItems.length - 3 && this._loadMoreAt !== current) {
        this._loadMoreAt = current;
        this.loadFeed(false);
      }
    });
  },

  onGalleryChange(event) {
    const postId = event.currentTarget.dataset.id;
    const current = Number(event.detail.current);
    if (!postId || !Number.isInteger(current)) return;
    const galleryIndices = Object.assign({}, this.data.galleryIndices, { [postId]: current });
    if (postId === this.data.activePostId) this.pauseActiveVideo();
    this.setData({ galleryIndices, videoPlaying: false, videoLoading: false, videoFailed: false }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  onVideoTap() {
    if (this.data.videoRetrying || this.data.videoFailed) return;
    if (this.data.videoPlaying) {
      this.pauseActiveVideo();
    } else {
      this.playActiveVideo();
    }
  },

  onVideoPlay(event) {
    const postId = event.currentTarget.dataset.postId;
    if (postId !== this.data.activePostId) return;
    if (this.data.browseView !== 'feed' || !this.data.pageVisible || this.data.commentPost || this.data.composerOpen
      || this.data.searchOpen || this.data.cityPickerOpen || this.data.mediaActionsItem) {
      wx.createVideoContext('fashion-active-video', this).pause();
      return;
    }
    this._videoContextReady = true;
    this.setData({ videoPlaying: true, videoLoading: false, videoFailed: false });
  },

  onVideoPause(event) {
    if (event.currentTarget.dataset.postId !== this.data.activePostId) return;
    this.setData({ videoPlaying: false, videoLoading: false });
  },

  onVideoTimeUpdate(event) {
    if (event.currentTarget.dataset.postId !== this.data.activePostId) return;
    const detail = event.detail || {};
    const duration = Number(detail.duration);
    const currentTime = Number(detail.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return;
    const progress = Math.min(1, Math.max(0, currentTime / duration));
    this._trackedViewIds = this._trackedViewIds || new Set();
    this._completedViewIds = this._completedViewIds || new Set();
    if (currentTime >= 2 && !this._trackedViewIds.has(postId)) {
      this._trackedViewIds.add(postId);
      void recordFashionPostView(postId, Math.round(currentTime * 1000), false)
        .catch(error => console.warn('[mini-fashion-view-track]', error));
    }
    if (progress >= 0.95 && !this._completedViewIds.has(postId)) {
      this._completedViewIds.add(postId);
      void recordFashionPostView(postId, Math.round(duration * 1000), true)
        .catch(error => console.warn('[mini-fashion-view-complete]', error));
    }
    if (Math.abs(progress - this.data.videoProgress) < 0.005) return;
    this.setData({ videoProgress: progress });
  },

  resolveActionItem(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const id = dataset.id || (this.data.mediaActionsItem && this.data.mediaActionsItem.id) || '';
    if (!id) return null;
    return this.data.items.find(entry => entry.id === id) || null;
  },

  currentItemMedia(item) {
    if (!item || !item.mediaItems || !item.mediaItems.length) return null;
    const index = Math.max(0, Math.min(
      (this.data.galleryIndices || {})[item.id] || 0,
      Math.max(item.mediaItems.length - 1, 0)
    ));
    return item.mediaItems[index] || null;
  },

  applyFeedFeedback(patch) {
    this.setData(patch);
    this.refreshVisibleItems(this.data.items, this.data.social, this._visibleMode || this.data.mode);
  },

  openMediaActions(event) {
    const item = this.resolveActionItem(event);
    if (!item) return;
    this.setData({ mediaActionsItem: { id: item.id, displayTitle: item.displayTitle || '' } });
  },

  closeMediaActions() {
    if (this.data.mediaActionsItem) this.setData({ mediaActionsItem: null });
  },

  noop() {},

  dismissedStorageKey() {
    return `${FASHION_DISMISSED_STORAGE_PREFIX}${this.data.viewerId || 'guest'}`;
  },

  restoreDismissedItems() {
    let stored = [];
    try {
      const raw = wx.getStorageSync(this.dismissedStorageKey());
      if (Array.isArray(raw)) stored = raw.filter(id => typeof id === 'string' && id);
    } catch (error) {
      console.warn('[mini-fashion-dismissed-restore]', error);
    }
    if (stored.length) this.setData({ dismissedIds: stored.slice(-FASHION_DISMISSED_LIMIT) });
  },

  async dismissPost(event) {
    const item = this.resolveActionItem(event);
    if (!item) return;
    if (!(await this.ensureAccount())) return;
    try {
      await hideFashionPost(item.id);
    } catch (error) {
      wx.showToast({ title: error && error.message || '暂时无法记录反馈', icon: 'none' });
      return;
    }
    const next = this.data.dismissedIds.includes(item.id)
      ? this.data.dismissedIds
      : this.data.dismissedIds.concat(item.id).slice(-FASHION_DISMISSED_LIMIT);
    try {
      wx.setStorageSync(this.dismissedStorageKey(), next);
    } catch (error) {
      console.warn('[mini-fashion-dismissed-save]', error);
    }
    this.applyFeedFeedback({ dismissedIds: next, mediaActionsItem: null });
    wx.showToast({ title: '已减少此类内容', icon: 'none' });
  },

  async translatePost(event) {
    const item = this.resolveActionItem(event);
    if (!item) return;
    if (this.data.translations[item.id]) {
      const translationVisible = Object.assign({}, this.data.translationVisible, {
        [item.id]: !this.data.translationVisible[item.id]
      });
      this.applyFeedFeedback({ translationVisible });
      return;
    }
    if (this.data.translationPending[item.id]) return;
    const text = [item.displayTitle, item.text].filter(Boolean).join('\n').trim();
    if (!text) {
      wx.showToast({ title: '这条内容没有可翻译的文字', icon: 'none' });
      return;
    }
    this.setData({ translationPending: Object.assign({}, this.data.translationPending, { [item.id]: true }) });
    try {
      const result = await translateFashionText({ text, language: 'it' });
      const translation = typeof result.translation === 'string' ? result.translation.trim() : '';
      if (!translation) throw new Error('EMPTY_TRANSLATION');
      this.applyFeedFeedback({
        translations: Object.assign({}, this.data.translations, { [item.id]: translation }),
        translationVisible: Object.assign({}, this.data.translationVisible, { [item.id]: true })
      });
    } catch (error) {
      wx.showToast({ title: '翻译暂不可用，请稍后重试', icon: 'none' });
    } finally {
      this.setData({
        translationPending: Object.assign({}, this.data.translationPending, { [item.id]: false })
      });
    }
  },

  previewPostMedia(event) {
    const item = this.resolveActionItem(event);
    const media = this.currentItemMedia(item);
    if (!item || !media) {
      wx.showToast({ title: '暂无可查看的图片', icon: 'none' });
      return;
    }
    const images = (item.mediaItems || []).filter(entry => entry.type === 'image' && entry.url).map(entry => entry.url);
    if (!images.length) {
      wx.showToast({ title: '视频请使用保存到相册', icon: 'none' });
      return;
    }
    const current = media.type === 'image' && media.url ? media.url : images[0];
    this.setData({ mediaActionsItem: null });
    wx.previewImage({ current, urls: images });
  },

  downloadMediaToAlbum(media) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: media.url,
        success: response => {
          if (response.statusCode !== 200) {
            reject(new Error('MEDIA_DOWNLOAD_FAILED'));
            return;
          }
          const options = { filePath: response.tempFilePath, success: resolve, fail: reject };
          if (media.type === 'video') {
            wx.saveVideoToPhotosAlbum(options);
            return;
          }
          wx.saveImageToPhotosAlbum(options);
        },
        fail: reject
      });
    });
  },

  savePostMedia(event) {
    const item = this.resolveActionItem(event);
    const media = this.currentItemMedia(item);
    if (!media || !media.url) {
      wx.showToast({ title: '暂无可保存的媒体', icon: 'none' });
      return;
    }
    this.setData({ mediaActionsItem: null });
    wx.showLoading({ title: '正在保存', mask: true });
    this.downloadMediaToAlbum(media).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已保存到相册', icon: 'none' });
    }).catch(error => {
      wx.hideLoading();
      const message = String((error && error.errMsg) || (error && error.message) || '').toLowerCase();
      if (message.includes('auth') || message.includes('authorize') || message.includes('permission')) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存作品到相册需要相册权限，请在设置中开启后重试。',
          confirmText: '去设置',
          success: result => { if (result.confirm && wx.openSetting) wx.openSetting(); }
        });
        return;
      }
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' });
    });
  },

  copyPostLink(event) {
    const item = this.resolveActionItem(event);
    if (!item) return;
    const link = `${API_BASE_URL}${FASHION_SHARE_PATH}?post=${encodeURIComponent(item.id)}`;
    this.setData({ mediaActionsItem: null });
    wx.setClipboardData({
      data: link,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  },

  onVideoWaiting(event) {
    if (event.currentTarget.dataset.postId === this.data.activePostId
      && this.data.browseView === 'feed' && this.data.pageVisible && !this.data.commentPost && !this.data.composerOpen
      && !this.data.searchOpen && !this.data.cityPickerOpen) {
      this.setData({ videoLoading: true });
    }
  },

  toggleVideoSound() {
    const videoMuted = !this.data.videoMuted;
    this.setData({ videoMuted });
    if (!videoMuted) this.playActiveVideo();
  },

  onVideoError(event) {
    if (event.currentTarget.dataset.postId !== this.data.activePostId) return;
    this._playbackGeneration += 1;
    this.setData({ videoPlaying: false, videoLoading: false, videoFailed: true });
  },

  onMediaImageError(event) {
    const postId = event.currentTarget.dataset.id;
    const mediaIndex = Number(event.currentTarget.dataset.mediaIndex || 0);
    if (!postId) return;
    const key = `${postId}:${mediaIndex}`;
    this.setData({ mediaLoadErrors: Object.assign({}, this.data.mediaLoadErrors, { [key]: true }) });
    this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
  },

  retryMediaImage(event) {
    const postId = event.currentTarget.dataset.id;
    const mediaIndex = Number(event.currentTarget.dataset.mediaIndex || 0);
    const mediaLoadErrors = Object.assign({}, this.data.mediaLoadErrors);
    delete mediaLoadErrors[`${postId}:${mediaIndex}`];
    this.setData({ mediaLoadErrors });
    this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
  },

  retryActiveVideo() {
    const active = this.data.visibleItems[this.data.activeFeedIndex];
    if (!active || !active.currentMedia || active.currentMedia.type !== 'video') return;
    this.pauseActiveVideo();
    this.setData({ videoRetrying: true, videoFailed: false }, () => {
      this.setData({ videoRetrying: false }, () => {
        this.playActiveVideo();
      });
    });
  },

  onPullDownRefresh() {
    this.loadFeed(true);
  },

  onRetry() {
    this.loadFeed(this.data.items.length === 0 || !this.data.hasMore);
  },

  refreshFashionNotificationCount() {
    getFashionNotifications(1, 0)
      .then(result => this.setData({ notificationUnread: Number(result.unreadCount) || 0 }))
      .catch(() => this.setData({ notificationUnread: 0 }));
  },

  loadDiscoverTags() {
    getFashionTags()
      .then(result => this.setData({ discoverTags: Array.isArray(result.tags) ? result.tags.slice(0, 10) : [] }))
      .catch(() => this.setData({ discoverTags: [] }));
  },

  openFashionNotifications() {
    this.setData({ notificationsOpen: true, notificationsLoading: true });
    getFashionNotifications(30, 0)
      .then(result => {
        const unreadCount = Number(result.unreadCount) || 0;
        this.setData({
          notifications: Array.isArray(result.notifications) ? result.notifications : [],
          notificationUnread: unreadCount,
          notificationsLoading: false
        });
        if (unreadCount > 0) {
          markFashionNotificationsRead({ all: true })
            .then(() => this.setData({ notificationUnread: 0 }))
            .catch(() => undefined);
        }
      })
      .catch(error => {
        this.setData({ notificationsLoading: false });
        const needsLogin = error && (error.status === 401 || error.code === 'AUTH_REQUIRED');
        wx.showToast({ title: needsLogin ? '请先登录 RUDA 账户' : '消息加载失败', icon: 'none' });
      });
  },

  closeFashionNotifications() {
    this.setData({ notificationsOpen: false });
  },

  async removeFashionNotification(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.notifications[index];
    if (!item) return;
    try {
      await deleteFashionNotification(item.id);
      this.setData({
        notifications: this.data.notifications.filter(entry => entry.id !== item.id),
        notificationUnread: item.read ? this.data.notificationUnread : Math.max(0, this.data.notificationUnread - 1)
      });
    } catch (error) {
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
    }
  },

  openFashionAnalytics() {
    const session = getAuthSession();
    if (!session || !session.token) {
      wx.showToast({ title: '登录后查看作品数据', icon: 'none' });
      return;
    }
    this.pauseActiveVideo();
    this.setData({ analyticsOpen: true, analyticsError: '' });
    this.loadFashionAnalytics();
  },

  closeFashionAnalytics() {
    this.setData({ analyticsOpen: false }, () => this.resumeFeedVideo());
  },

  retryFashionAnalytics() {
    if (this.data.analyticsLoading) return;
    this.loadFashionAnalytics();
  },

  async loadFashionAnalytics() {
    if (this.data.analyticsLoading) return;
    this.setData({ analyticsLoading: true, analyticsError: '' });
    try {
      const result = await getFashionAnalytics();
      const posts = (result && Array.isArray(result.posts) ? result.posts : []).map(row => ({
        id: row.id,
        title: row.title || 'RUDA Fashion',
        image: getAssetUrl(row.image),
        statusLabel: row.publicationStatus === 'approved' ? '已发布'
          : row.publicationStatus === 'pending' ? '审核中'
            : row.publicationStatus === 'rejected' ? '未通过' : (row.publicationStatus || ''),
        approved: row.publicationStatus === 'approved',
        views: Number(row.views) || 0,
        completions: Number(row.completions) || 0,
        avgWatchedLabel: `${Math.round((Number(row.avgWatchedMs) || 0) / 100) / 10}s`,
        likes: Number(row.likes) || 0,
        comments: Number(row.comments) || 0,
        saves: Number(row.saves) || 0,
        productClicks: Number(row.productClicks) || 0
      }));
      this.setData({
        analyticsTotals: result && result.totals ? result.totals : null,
        analyticsPosts: posts,
        analyticsLoading: false
      });
    } catch (error) {
      const needsLogin = error && (error.status === 401 || error.code === 'AUTH_REQUIRED');
      this.setData({
        analyticsLoading: false,
        analyticsError: needsLogin ? '请先登录 RUDA 账户后查看作品数据' : '作品数据加载失败，点击重试'
      });
    }
  },

  async deleteAnalyticsPost(event) {
    const postId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '');
    if (!postId) return;
    const confirmed = await new Promise(resolve => {
      wx.showModal({
        title: '删除作品',
        content: '删除后作品将从信息流移除，是否继续？',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;
    try {
      await deleteFashionPost(postId);
      this.setData({
        analyticsPosts: this.data.analyticsPosts.filter(post => post.id !== postId),
        items: this.data.items.filter(post => post.id !== postId)
      }, () => this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode));
      wx.showToast({ title: '作品已删除', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error && error.message || '删除失败', icon: 'none' });
    }
  },

  openFashionNotification(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.notifications[index];
    if (!item) return;
    this.setData({ notificationsOpen: false });
    if (item.postId) {
      const feedIndex = this.data.visibleItems.findIndex(entry => entry.id === item.postId);
      this._requestedPostId = item.postId;
      if (feedIndex >= 0) {
        this.pauseActiveVideo();
        this._activeMediaKey = '';
        this.setData({ browseView: 'feed', activeFeedIndex: feedIndex, videoFailed: false }, () => {
          this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
        });
      } else {
        this.setData({ browseView: 'feed', mode: 'featured', categoryIndex: 0, cityIndex: 0 }, () => this.loadFeed(true));
      }
      return;
    }
    if (item.actorAccountId) {
      this.openCreator({ currentTarget: { dataset: { id: item.actorAccountId } } });
    }
  },

  onDiscoverTagTap(event) {
    const tag = String(event.currentTarget.dataset.tag || '').replace(/^#/, '').trim();
    if (!tag) return;
    this.setData({ searchOpen: true, searchQuery: tag, searchSubmitted: false }, () => this.submitFashionSearch());
  },

  stopTap() {},

  async onModeChange(event) {
    const mode = this.data.modes[Number(event.currentTarget.dataset.index)];
    if (!mode) return;
    if (mode.id === 'shop') {
      this.openFashionShop();
      return;
    }
    if (mode.id === this.data.mode && (mode.id !== 'prato' || this.data.cityIndex === cities.indexOf('Prato'))) return;
    if ((mode.id === 'saved' || mode.id === 'following') && !(await this.ensureAccount())) return;
    this.pauseActiveVideo();
    this._activeMediaKey = '';
    this._magazineScrollTop = 0;
    const cityIndex = mode.id === 'prato' ? cities.indexOf('Prato') : 0;
    const browseView = this.data.browseView;
    this.setData({ browseView, mode: mode.id, cityIndex, activeFeedIndex: 0, galleryIndices: {}, magazineScrollTop: 0 }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: browseView === 'feed' });
      this.loadFeed(true);
    });
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  goHomeFromDisabled() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  async onFashionShortcut(event) {
    const key = event.currentTarget.dataset.key;
    if (key === 'home') {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    if (key === 'create') {
      this.openComposer();
      return;
    }
    if (key === 'profile') {
      wx.navigateTo({ url: '/pages/settings/index' });
      return;
    }
    if (key !== 'friends' || !(await this.ensureAccount())) return;
    this.pauseActiveVideo();
    this._activeMediaKey = '';
    this.setData({
      browseView: 'feed',
      mode: 'following',
      categoryIndex: 0,
      cityIndex: 0,
      activeFeedIndex: 0,
      galleryIndices: {}
    }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: true });
      this.loadFeed(true);
    });
  },

  openFashionShop() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  openFashionSearch() {
    this.pauseActiveVideo();
    this._searchGeneration = (this._searchGeneration || 0) + 1;
    this._searchLoading = false;
    this.setData({
      searchOpen: true,
      searchQuery: '',
      searchSubmitted: false,
      searchResults: [],
      searchLoading: false,
      searchError: '',
      searchHasMore: false
    }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  closeFashionSearch() {
    this.setData({ searchOpen: false }, () => this.resumeFeedVideo());
  },

  onFashionSearchInput(event) {
    this._searchGeneration = (this._searchGeneration || 0) + 1;
    this._searchLoading = false;
    this.setData({
      searchQuery: event.detail.value || '',
      searchSubmitted: false,
      searchResults: [],
      searchLoading: false,
      searchError: '',
      searchHasMore: false
    });
  },

  submitFashionSearch() {
    const searchQuery = String(this.data.searchQuery || '').trim();
    if (!searchQuery) {
      wx.showToast({ title: '请输入视频或图片关键词', icon: 'none' });
      return;
    }
    this.setData({ searchQuery, searchSubmitted: true }, () => this.loadFashionSearch(true));
  },

  async loadFashionSearch(reset) {
    const search = String(this.data.searchQuery || '').trim();
    if (!search) return;
    if (this._searchLoading && !reset) return;
    if (reset) {
      this._searchGeneration = (this._searchGeneration || 0) + 1;
      this._searchOffset = 0;
    }
    const generation = this._searchGeneration || 0;
    this._searchLoading = true;
    const offset = this._searchOffset || 0;
    this.setData({
      searchLoading: true,
      searchError: '',
      searchResults: reset ? [] : this.data.searchResults,
      searchHasMore: reset ? false : this.data.searchHasMore
    });
    try {
      const result = await getFashionPosts({
        search,
        limit: 24,
        offset,
        sort: 'latest'
      });
      if (generation !== this._searchGeneration || search !== String(this.data.searchQuery || '').trim()) return;
      const nextResults = (result.posts || []).map(presentPost);
      const existing = new Set((reset ? [] : this.data.searchResults).map(post => post.id));
      const searchResults = (reset ? [] : this.data.searchResults)
        .concat(nextResults.filter(post => !existing.has(post.id)));
      this._searchOffset += nextResults.length;
      this.setData({
        searchResults,
        searchHasMore: Boolean(result.hasMore && nextResults.length),
        searchLoading: false
      });
    } catch (error) {
      if (generation !== this._searchGeneration || search !== String(this.data.searchQuery || '').trim()) return;
      this.setData({
        searchError: error.message || '搜索暂时不可用，请重试。',
        searchLoading: false
      });
    } finally {
      if (generation === this._searchGeneration) this._searchLoading = false;
    }
  },

  loadMoreFashionSearch() {
    if (this.data.searchHasMore && !this.data.searchLoading) this.loadFashionSearch(false);
  },

  openFashionSearchResult(event) {
    const postId = String(event.currentTarget.dataset.id || '');
    if (!postId) return;
    if (this.data.loading || this.data.loadingMore) {
      wx.showToast({ title: '内容加载中，请稍后再试', icon: 'none' });
      return;
    }
    this._requestedPostId = postId;
    this.setData({
      browseView: 'feed',
      searchOpen: false,
      mode: 'featured',
      categoryIndex: 0,
      cityIndex: 0,
      activeFeedIndex: 0,
      galleryIndices: {}
    }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: true });
      this.loadFeed(true);
    });
  },

  onCategoryChange(event) {
    const categoryIndex = Number(event.currentTarget && event.currentTarget.dataset.index !== undefined
      ? event.currentTarget.dataset.index
      : event.detail.value);
    if (!Number.isInteger(categoryIndex) || categoryIndex < 0 || categoryIndex >= (this.data.categories || categories).length
      || categoryIndex === this.data.categoryIndex) return;
    this.pauseActiveVideo();
    this._activeMediaKey = '';
    this._magazineScrollTop = 0;
    this.setData({ browseView: 'grid', categoryIndex, activeFeedIndex: 0, galleryIndices: {}, magazineScrollTop: 0 }, () => this.loadFeed(true));
  },

  onSeasonFilterChange(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset.index !== undefined
      ? event.currentTarget.dataset.index
      : event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= seasonOptions.length || index === this.data.seasonIndex) return;
    this.pauseActiveVideo();
    this._activeMediaKey = '';
    this._magazineScrollTop = 0;
    this.setData({ seasonIndex: index, activeFeedIndex: 0, galleryIndices: {}, magazineScrollTop: 0 }, () => this.loadFeed(true));
  },

  onCityChange(event) {
    const cityIndex = Number(event.detail.value);
    if (!Number.isInteger(cityIndex) || cityIndex < 0 || cityIndex >= cities.length) return;
    this.setData({
      browseView: 'grid',
      mode: cityIndex === 0 ? 'featured' : 'prato',
      cityIndex,
      activeFeedIndex: 0,
      galleryIndices: {},
      magazineScrollTop: 0
    }, () => this.loadFeed(true));
  },

  openCityPicker() {
    this.pauseActiveVideo();
    this.setData({
      cityPickerOpen: true,
      citySearch: '',
      citySectionTarget: '',
      filteredCities: popularCities
    }, () => {
      this.refreshVisibleItems(this.data.items, this.data.social, this.data.mode);
    });
  },

  closeCityPicker() {
    this.setData({ cityPickerOpen: false, citySearch: '' }, () => this.resumeFeedVideo());
  },

  onHashtagTap(event) {
    const tag = String(event.currentTarget.dataset.tag || '').replace(/^#+/, '');
    if (!tag) return;
    this._searchGeneration = (this._searchGeneration || 0) + 1;
    this._searchLoading = false;
    this.setData({
      searchOpen: true,
      searchQuery: `#${tag}`,
      searchSubmitted: true,
      searchResults: [],
      searchLoading: false,
      searchError: '',
      searchHasMore: false
    }, () => this.loadFashionSearch(true));
  },

  onCityLetterTap(event) {
    this.setData({ citySectionTarget: `city-letter-${event.currentTarget.dataset.letter}` });
  },

  onCitySearch(event) {
    const value = String(event.detail && event.detail.value || '');
    const citySearch = value.trim().toLocaleLowerCase();
    this.setData({
      citySearch: value,
      filteredCities: popularCities.filter(city => city.toLocaleLowerCase().includes(citySearch))
    });
  },

  clearCitySearch() {
    this.setData({ citySearch: '', filteredCities: popularCities });
  },

  selectFashionCity(event) {
    const city = String(event.currentTarget.dataset.city || '');
    const cityIndex = cities.indexOf(city);
    if (cityIndex < 0) return;
    const browseView = this.data.browseView;
    this.setData({
      browseView,
      cityPickerOpen: false,
      citySearch: '',
      mode: cityIndex === 0 ? 'featured' : 'prato',
      cityIndex,
      activeFeedIndex: 0,
      galleryIndices: {},
      magazineScrollTop: 0
    }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: browseView === 'feed' });
      this.loadFeed(true);
    });
  },

  isInteractionBlocked(post) {
    return !post || !post.socialEnabled;
  },

  updateSocial(id, patch) {
    const social = Object.assign({}, this.data.social, { [id]: Object.assign({}, this.data.social[id] || {}, patch) });
    this.setData({ social });
    this.refreshVisibleItems(this.data.items, social, this.data.mode);
  },

  async toggleLike(event) {
    const item = this.data.items.find(entry => entry.id === event.currentTarget.dataset.id);
    if (this.isInteractionBlocked(item)) {
      wx.showToast({ title: '该作品暂不支持互动', icon: 'none' });
      return;
    }
    const lockKey = item && `like:${item.id}`;
    if (!item || this._socialLocks.has(lockKey)) return;
    this._socialLocks.add(lockKey);
    try {
      const result = await reactFashionPost(item.id, this.data.viewerId, 'like');
      this.updateSocial(item.id, { liked: result.liked, likesCount: result.likesCount });
    } catch (error) {
      wx.showToast({ title: error.message || '点赞失败', icon: 'none' });
    } finally {
      this._socialLocks.delete(lockKey);
    }
  },

  async toggleSave(event) {
    const item = this.data.items.find(entry => entry.id === event.currentTarget.dataset.id);
    if (this.isInteractionBlocked(item)) {
      wx.showToast({ title: '该作品暂不支持互动', icon: 'none' });
      return;
    }
    const lockKey = item && `save:${item.id}`;
    if (!item || this._socialLocks.has(lockKey) || !(await this.ensureAccount())) return;
    this._socialLocks.add(lockKey);
    try {
      const result = await reactFashionPost(item.id, this.data.viewerId, 'save');
      this.updateSocial(item.id, { saved: result.saved, savesCount: result.savesCount });
      wx.showToast({ title: result.saved ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '收藏失败', icon: 'none' });
    } finally {
      this._socialLocks.delete(lockKey);
    }
  },

  async toggleFollow(event) {
    const item = this.data.items.find(entry => entry.id === event.currentTarget.dataset.id);
    if (this.isInteractionBlocked(item)) {
      wx.showToast({ title: '该作品暂不支持互动', icon: 'none' });
      return;
    }
    const lockKey = item && `follow:${item.creatorId}`;
    if (!item || !item.creatorId || this._socialLocks.has(lockKey) || !(await this.ensureAccount())) return;
    this._socialLocks.add(lockKey);
    try {
      const result = await followFashionCreator(item.creatorId);
      this.updateSocial(item.creatorId, { following: result.following, followersCount: result.followersCount });
    } catch (error) {
      wx.showToast({ title: error.message || '关注失败', icon: 'none' });
    } finally {
      this._socialLocks.delete(lockKey);
    }
  },

  async openComments(event) {
    const item = this.data.items.find(entry => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (this.isInteractionBlocked(item)) {
      wx.showToast({ title: '该作品暂不支持互动', icon: 'none' });
      return;
    }
    this.pauseActiveVideo();
    this.setData({
      commentPost: item,
      comments: [],
      commentsLoading: false,
      commentsError: '',
      commentDraft: '',
      replyTarget: null,
      commentsHasMore: false
    });
    await this.loadComments(item);
  },

  async loadComments(post) {
    if (!post || (this.data.commentsLoading && this.data.commentPost && this.data.commentPost.id === post.id)) return;
    this._commentsRequestId = (this._commentsRequestId || 0) + 1;
    const requestId = this._commentsRequestId;
    this.setData({ commentsLoading: true, commentsError: '' });
    try {
      const result = await getFashionComments(post.id, 20, 0);
      if (requestId !== this._commentsRequestId
        || !this.data.commentPost || this.data.commentPost.id !== post.id) return;
      const mapComment = comment => Object.assign({}, comment, {
        authorName: comment.displayName || comment.authorName || 'RUDA 用户',
        authorInitial: (comment.displayName || comment.authorName || 'R')[0],
        replies: (comment.replies || []).map(reply => Object.assign({}, reply, {
          authorName: reply.displayName || 'RUDA 用户',
          authorInitial: (reply.displayName || 'R')[0],
          replies: []
        }))
      });
      const comments = (result.comments || []).map(mapComment);
      this.setData({
        comments,
        commentsLoading: false,
        commentsHasMore: Boolean(result.hasMore),
        'commentPost.commentsCount': result.commentsCount || comments.length
      });
    } catch (error) {
      if (requestId !== this._commentsRequestId
        || !this.data.commentPost || this.data.commentPost.id !== post.id) return;
      this.setData({
        commentsLoading: false,
        commentsError: error.message || '评论加载失败，请重试。'
      });
    }
  },

  async loadMoreComments() {
    const post = this.data.commentPost;
    if (!post || this.data.commentsLoading || !this.data.commentsHasMore) return;
    this.setData({ commentsLoading: true });
    try {
      const result = await getFashionComments(post.id, 20, this.data.comments.length);
      if (!this.data.commentPost || this.data.commentPost.id !== post.id) return;
      const comments = this.data.comments.concat((result.comments || []).map(comment => Object.assign({}, comment, {
        authorName: comment.displayName || 'RUDA 用户',
        authorInitial: (comment.displayName || 'R')[0],
        replies: (comment.replies || []).map(reply => Object.assign({}, reply, {
          authorName: reply.displayName || 'RUDA 用户',
          authorInitial: (reply.displayName || 'R')[0],
          replies: []
        }))
      })));
      this.setData({ comments, commentsLoading: false, commentsHasMore: Boolean(result.hasMore) });
    } catch (error) {
      this.setData({ commentsLoading: false, commentsError: error.message || '评论加载失败，请重试。' });
    }
  },

  setReplyTarget(event) {
    const comment = this.data.comments.find(item => item.id === event.currentTarget.dataset.id);
    if (!comment) return;
    this.setData({ replyTarget: { id: comment.id, displayName: comment.authorName } });
  },

  cancelReply() {
    this.setData({ replyTarget: null });
  },

  async deleteComment(event) {
    const post = this.data.commentPost;
    const commentId = String(event.currentTarget.dataset.id || '');
    if (!post || !commentId) return;
    const confirmed = await new Promise(resolve => {
      wx.showModal({
        title: '删除评论',
        content: '删除后无法恢复，确定继续？',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;
    try {
      const result = await deleteFashionComment(post.id, commentId);
      this.setData({ comments: [] });
      await this.loadComments(post);
      if (result && typeof result.commentsCount === 'number') this.updateSocial(post.id, { commentsCount: result.commentsCount });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  },

  async reportComment(event) {
    const post = this.data.commentPost;
    const commentId = String(event.currentTarget.dataset.id || '');
    if (!post || !commentId) return;
    const reasons = ['侵犯版权', '骚扰或仇恨', '垃圾广告', '虚假信息', '其他'];
    const reasonKeys = ['copyright', 'harassment', 'spam', 'misinformation', 'other'];
    const picked = await new Promise(resolve => {
      wx.showActionSheet({
        itemList: reasons,
        success: result => resolve(reasonKeys[result.tapIndex] || 'other'),
        fail: () => resolve('')
      });
    });
    if (!picked) return;
    try {
      await reportFashionContent('comment', commentId, picked, '');
      wx.showToast({ title: '举报已提交', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '举报失败', icon: 'none' });
    }
  },

  retryComments() {
    if (!this.data.commentPost || this.data.commentsLoading) return;
    void this.loadComments(this.data.commentPost);
  },

  onCommentInput(event) {
    this.setData({ commentDraft: event.detail.value.slice(0, 300) });
  },

  async submitComment() {
    const post = this.data.commentPost;
    const text = this.data.commentDraft.trim();
    if (!post || !text || this.data.commentSubmitting) return;
    if (!(await this.ensureAccount())) return;
    this.setData({ commentSubmitting: true });
    try {
      const result = await addFashionComment(post.id, this.data.viewerId, text, this.data.replyTarget ? this.data.replyTarget.id : '');
      this.setData({ commentDraft: '', replyTarget: null });
      await this.loadComments(post);
      this.updateSocial(post.id, { commentsCount: result.commentsCount });
    } catch (error) {
      wx.showToast({ title: error.message || '评论发送失败', icon: 'none' });
    } finally {
      this.setData({ commentSubmitting: false });
    }
  },

  closeComments() {
    this._commentsRequestId = (this._commentsRequestId || 0) + 1;
    this.setData({
      commentPost: null,
      comments: [],
      commentsError: ''
    }, () => this.resumeFeedVideo());
  },

  async loadServerDrafts() {
    const session = getAuthSession();
    if (!session || !session.token) {
      this.setData({ serverDrafts: [], serverDraftsLoading: false, serverDraftsError: '', serverDraftsSignedOut: true });
      return;
    }
    this.setData({ serverDraftsLoading: true, serverDraftsError: '', serverDraftsSignedOut: false });
    try {
      const result = await getFashionDrafts();
      const drafts = (Array.isArray(result && result.drafts) ? result.drafts : []).map(draft => {
        const mediaItems = Array.isArray(draft.mediaItems) ? draft.mediaItems : [];
        const videoCount = mediaItems.filter(item => item && item.type === 'video').length;
        const imageCount = mediaItems.length - videoCount;
        const summary = [videoCount ? `视频 ${videoCount}` : '', imageCount ? `图片 ${imageCount}` : ''].filter(Boolean).join(' · ');
        return {
          id: draft.id,
          title: typeof draft.title === 'string' ? draft.title : '',
          caption: typeof draft.caption === 'string' ? draft.caption : '',
          hashtags: Array.isArray(draft.hashtags) ? draft.hashtags : [],
          category: typeof draft.category === 'string' ? draft.category : '',
          city: typeof draft.city === 'string' ? draft.city : '',
          season: typeof draft.season === 'string' ? draft.season : '',
          productIds: Array.isArray(draft.productIds) ? draft.productIds : [],
          mediaItems,
          mediaSummary: summary || '无素材',
          updatedLabel: formatDraftTimestamp(draft.updatedAt)
        };
      });
      this.setData({ serverDrafts: drafts });
    } catch (error) {
      console.warn('[mini-fashion-server-drafts]', error);
      if (error && error.status === 401) {
        this.setData({ serverDrafts: [], serverDraftsSignedOut: true });
      } else {
        this.setData({ serverDraftsError: '草稿加载失败，点击重试' });
      }
    } finally {
      this.setData({ serverDraftsLoading: false });
    }
  },

  retryServerDrafts() {
    if (this.data.serverDraftsLoading) return;
    void this.loadServerDrafts();
  },

  async restoreServerDraft(event) {
    const draftId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '');
    const draft = this.data.serverDrafts.find(item => item.id === draftId);
    if (!draft) return;
    if (!(await this.ensureAccount())) return;
    const media = buildRemoteDraftMedia(draft.mediaItems);
    if (!media.length) {
      wx.showToast({ title: '草稿中的素材已过期，请删除后重新上传', icon: 'none' });
      return;
    }
    this.pauseActiveVideo();
    this._serverDraftId = draft.id;
    this._postIdempotencyKey = createIdempotencyKey();
    const categoryIndex = (this.data.postCategories || postCategories).indexOf(draft.category);
    const cityIndex = cities.indexOf(draft.city);
    const seasonIndex = fashionSeasons.indexOf(draft.season);
    this.setData({
      composerOpen: true,
      composerStep: 'preview',
      publicationResult: null,
      draftMedia: media,
      activeMediaIndex: 0,
      coverMediaIndex: 0,
      postTitle: draft.title,
      postText: draft.caption,
      postHashtags: draft.hashtags,
      hashtagDraft: '',
      postCategoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
      postCityIndex: cityIndex > 0 ? cityIndex : cities.indexOf('Prato'),
      postSeasonIndex: seasonIndex >= 0 ? seasonIndex + 1 : 0,
      selectedProduct: null,
      postVisibilityIndex: 0,
      commentsEnabled: true,
      rightsConfirmed: false,
      uploadError: '',
      uploadProgress: 0,
      uploadCurrentLabel: '',
      draftRestoreWarning: draft.mediaItems.length !== media.length
        ? '部分云端素材缺少上传凭证，已跳过失效素材'
        : '已从云端恢复草稿，可继续编辑并发布'
    });
    if (draft.productIds.length) {
      const productId = String(draft.productIds[0] || '');
      if (productId) {
        getProduct(productId).then(response => {
          const product = response && response.product ? response.product : response;
          if (!product || !this.data.composerOpen) return;
          const cover = product.image || product.coverUrl || (Array.isArray(product.images) ? product.images[0] : '');
          this.setData({
            selectedProduct: {
              id: product.id,
              displayName: product.name || product.name_zh || product.styleNo || '关联商品',
              name: product.name,
              name_zh: product.name_zh,
              brand: product.brand,
              styleNo: product.styleNo || '',
              coverUrl: cover,
              wholesalePrice: product.wholesalePrice
            }
          });
        }).catch(() => undefined);
      }
    }
  },

  async deleteServerDraft(event) {
    const draftId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '');
    if (!draftId) return;
    const confirmed = await new Promise(resolve => {
      wx.showModal({
        title: '删除草稿',
        content: '删除后无法恢复，是否继续？',
        success: result => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;
    try {
      await deleteFashionDraft(draftId);
      if (this._serverDraftId === draftId) this._serverDraftId = '';
      this.setData({ serverDrafts: this.data.serverDrafts.filter(item => item.id !== draftId) });
      wx.showToast({ title: '草稿已删除', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error && error.message || '删除失败', icon: 'none' });
    }
  },

  async buildServerDraftPayload(labelPrefix) {
    const mediaItems = [];
    const source = this.data.draftMedia;
    for (let index = 0; index < source.length; index += 1) {
      const media = source[index];
      let uploadToken = media.uploadToken || '';
      if (!uploadToken) {
        if (!media.filePath) continue;
        this.setData({ uploadCurrentLabel: `${labelPrefix} ${index + 1}/${source.length}` });
        const uploaded = await uploadFashionPostAsset(media.filePath, {
          type: media.type,
          kind: 'media',
          filename: media.name || getBaseName(media.filePath),
          draft: true
        });
        uploadToken = uploaded.uploadToken;
      }
      let posterToken = media.posterToken || '';
      if (media.type === 'video' && !posterToken && media.posterPath) {
        this.setData({ uploadCurrentLabel: `${labelPrefix} ${index + 1}/${source.length}` });
        const posterUploaded = await uploadFashionPostAsset(media.posterPath, {
          type: 'video',
          kind: 'poster',
          filename: getBaseName(media.posterPath),
          draft: true
        });
        posterToken = posterUploaded.uploadToken;
      }
      media.uploadToken = uploadToken;
      if (posterToken) media.posterToken = posterToken;
      mediaItems.push(Object.assign({ type: media.type, uploadToken }, posterToken ? { posterToken } : {}));
    }
    this.setData({ draftMedia: this.data.draftMedia.slice() });
    return {
      title: this.data.postTitle.trim(),
      caption: this.data.postText.trim(),
      hashtags: this.data.postHashtags,
      category: (this.data.postCategories || postCategories)[this.data.postCategoryIndex] || '',
      city: cities[this.data.postCityIndex] === '全部地区' ? '' : cities[this.data.postCityIndex],
      season: this.data.postSeasonIndex > 0 ? fashionSeasons[this.data.postSeasonIndex - 1] : '',
      mediaItems,
      productIds: this.data.selectedProduct ? [this.data.selectedProduct.id] : []
    };
  },

  async restoreComposerDraft() {
    this._draftRestorePending = true;
    let savedDraft;
    try {
      savedDraft = wx.getStorageSync(FASHION_DRAFT_STORAGE_KEY);
    } catch (error) {
      console.warn('[mini-fashion-draft-read]', error);
      this._draftRestorePending = false;
      return;
    }
    if (!savedDraft || savedDraft.version !== 1 || !Array.isArray(savedDraft.draftMedia)) {
      this._draftRestorePending = false;
      return;
    }

    const availableMedia = [];
    for (const media of savedDraft.draftMedia) {
      if (!media || !['image', 'video'].includes(media.type) || typeof media.filePath !== 'string' || !media.filePath) continue;
      try {
        const mediaSize = await getLocalFileSize(media.filePath);
        if (!mediaSize) continue;
        if (media.type === 'video') {
          const posterSize = await getLocalFileSize(media.posterPath);
          if (!posterSize) continue;
        }
        availableMedia.push(Object.assign({}, media, {
          filePersistent: true,
          posterPersistent: media.type === 'video',
          trimStartSeconds: media.type === 'video' && Number.isFinite(media.trimStartSeconds) ? media.trimStartSeconds : 0,
          trimEndSeconds: media.type === 'video' && Number.isFinite(media.trimEndSeconds) ? media.trimEndSeconds : media.duration,
          muted: media.type === 'video' && media.muted === true
        }));
      } catch (_error) {
        continue;
      }
    }
    const missingMedia = availableMedia.length !== savedDraft.draftMedia.length;
    this._postIdempotencyKey = typeof savedDraft.idempotencyKey === 'string' && savedDraft.idempotencyKey
      ? savedDraft.idempotencyKey
      : createIdempotencyKey();
    const publicationResult = savedDraft.publicationResult
      && ['pending', 'approved', 'unpublished'].includes(savedDraft.publicationResult.status)
      && typeof savedDraft.publicationResult.postId === 'string'
      ? savedDraft.publicationResult
      : null;
    this.setData({
      draftMedia: availableMedia,
      activeMediaIndex: Math.min(Number(savedDraft.activeMediaIndex) || 0, Math.max(availableMedia.length - 1, 0)),
      coverMediaIndex: Number.isInteger(savedDraft.coverMediaIndex)
        ? Math.min(Math.max(savedDraft.coverMediaIndex, 0), Math.max(availableMedia.length - 1, 0))
        : 0,
      postTitle: typeof savedDraft.postTitle === 'string' ? savedDraft.postTitle : '',
      postText: typeof savedDraft.postText === 'string' ? savedDraft.postText : '',
      postHashtags: Array.isArray(savedDraft.postHashtags) ? savedDraft.postHashtags : [],
      hashtagDraft: typeof savedDraft.hashtagDraft === 'string' ? savedDraft.hashtagDraft : '',
      postCategoryIndex: Number.isInteger(savedDraft.postCategoryIndex) ? savedDraft.postCategoryIndex : 0,
      postCityIndex: Number.isInteger(savedDraft.postCityIndex) ? savedDraft.postCityIndex : cities.indexOf('Prato'),
      postSeasonIndex: Number.isInteger(savedDraft.postSeasonIndex) ? savedDraft.postSeasonIndex : 0,
      selectedProduct: savedDraft.selectedProduct && typeof savedDraft.selectedProduct.id === 'string'
        ? savedDraft.selectedProduct
        : null,
      postVisibilityIndex: Math.max(0, postVisibilityValues.indexOf(savedDraft.visibility || 'public')),
      commentsEnabled: savedDraft.commentsEnabled !== false,
      rightsConfirmed: savedDraft.rightsConfirmed === true,
      publicationResult,
      composerStep: publicationResult ? 'submitted' : (availableMedia.length ? 'preview' : 'capture'),
      draftRestoreWarning: missingMedia ? '部分草稿素材已失效，请重新选择后再发布' : '',
      uploadError: missingMedia ? '部分本地素材已失效，请重新选择并补齐作品素材' : ''
    });
    if (missingMedia) wx.showToast({ title: '部分草稿素材已失效，请重新选择', icon: 'none' });
    this._draftRestorePending = false;
  },

  persistComposerDraftSnapshot() {
    if (this.data.draftMedia.some(media => media.remote)) return;
    const snapshot = {
      version: 1,
      draftMedia: this.data.draftMedia,
      activeMediaIndex: this.data.activeMediaIndex,
      coverMediaIndex: this.data.coverMediaIndex,
      postTitle: this.data.postTitle,
      postText: this.data.postText,
      postHashtags: this.data.postHashtags,
      hashtagDraft: this.data.hashtagDraft,
      postCategoryIndex: this.data.postCategoryIndex,
      postCityIndex: this.data.postCityIndex,
      postSeasonIndex: this.data.postSeasonIndex,
      selectedProduct: this.data.selectedProduct,
      visibility: postVisibilityValues[this.data.postVisibilityIndex] || 'public',
      commentsEnabled: this.data.commentsEnabled,
      rightsConfirmed: this.data.rightsConfirmed,
      idempotencyKey: this._postIdempotencyKey || '',
      publicationResult: this.data.publicationResult || null
    };
    wx.setStorageSync(FASHION_DRAFT_STORAGE_KEY, snapshot);
  },

  scheduleComposerDraftSnapshot() {
    if (!this.data.draftMedia.length
      || this.data.draftMedia.some(media => !media.filePersistent || (media.type === 'video' && !media.posterPersistent))) return;
    if (this._draftAutosaveTimer) clearTimeout(this._draftAutosaveTimer);
    this._draftAutosaveTimer = setTimeout(() => {
      this._draftAutosaveTimer = null;
      try {
        this.persistComposerDraftSnapshot();
        this.setData({ draftRestoreWarning: '' });
      } catch (error) {
        console.error('[mini-fashion-draft-autosave]', error);
        this.setData({ draftRestoreWarning: '草稿自动保存失败，请点击“保存草稿”后重试' });
      }
    }, 350);
  },

  persistDraftWhenFilesReady() {
    if (this._draftAutosaveTimer) {
      clearTimeout(this._draftAutosaveTimer);
      this._draftAutosaveTimer = null;
    }
    if (!this.data.draftMedia.length
      || this.data.draftMedia.some(media => !media.filePersistent || (media.type === 'video' && !media.posterPersistent))) return;
    try {
      this.persistComposerDraftSnapshot();
    } catch (error) {
      console.error('[mini-fashion-draft-flush]', error);
      this.setData({ draftRestoreWarning: '草稿自动保存失败，请点击“保存草稿”后重试' });
    }
  },

  async persistComposerDraftFiles() {
    const draftMedia = this.data.draftMedia.map(media => Object.assign({}, media));
    for (let index = 0; index < draftMedia.length; index += 1) {
      const media = draftMedia[index];
      if (media.remote) continue;
      if (!media.filePersistent) {
        media.filePath = await savePersistentFile(media.filePath);
        media.filePersistent = true;
      }
      if (media.type === 'video' && !media.posterPersistent) {
        media.posterPath = await savePersistentFile(media.posterPath);
        media.posterPersistent = true;
      }
      this.setData({ draftMedia: draftMedia.slice() });
    }
    this.persistComposerDraftSnapshot();
  },

  async saveComposerDraft() {
    if (this.data.postSubmitting || this.data.draftSaving || this._draftSaveLock) return;
    if (!this.data.draftMedia.length && !this.data.postTitle.trim() && !this.data.postText.trim()) {
      wx.showToast({ title: '先填写内容或选择素材，再保存草稿', icon: 'none' });
      return;
    }
    if (!(await this.ensureAccount())) return;
    this._draftSaveLock = true;
    this.setData({ draftSaving: true, uploadError: '', uploadCurrentLabel: '准备云端草稿' });
    try {
      const payload = await this.buildServerDraftPayload('上传草稿素材');
      if (!payload.mediaItems.length) throw new Error('FASHION_DRAFT_MEDIA_REQUIRED');
      let draftId = this._serverDraftId;
      if (draftId) {
        await updateFashionDraft(draftId, payload);
      } else {
        const created = await createFashionDraft(payload);
        draftId = created && created.draft && typeof created.draft.id === 'string' ? created.draft.id : '';
      }
      this._serverDraftId = '';
      this._postIdempotencyKey = '';
      try {
        wx.removeStorageSync(FASHION_DRAFT_STORAGE_KEY);
      } catch (error) {
        console.warn('[mini-fashion-cloud-draft-clear]', error);
      }
      this.setData({
        composerOpen: false,
        publicationResult: null,
        draftMedia: [],
        activeMediaIndex: 0,
        coverMediaIndex: 0,
        draftRestoreWarning: '',
        postTitle: '',
        postText: '',
        postHashtags: [],
        hashtagDraft: '',
        selectedProduct: null,
        postVisibilityIndex: 0,
        commentsEnabled: true,
        rightsConfirmed: false,
        uploadProgress: 0,
        uploadCurrentLabel: '',
        uploadError: ''
      }, () => this.resumeFeedVideo());
      wx.showToast({ title: '草稿已保存到云端', icon: 'success' });
      void this.loadServerDrafts();
    } catch (error) {
      console.error('[mini-fashion-cloud-draft-save]', error);
      const messages = {
        NETWORK_ERROR: '网络中断，草稿尚未保存，请重试',
        REQUEST_TIMEOUT: '上传超时，草稿尚未保存，请重试',
        FASHION_DRAFT_EMPTY: '草稿内容为空，请补充后再保存',
        FASHION_DRAFT_RATE_LIMITED: '保存过于频繁，请稍后再试',
        FASHION_DRAFT_MEDIA_REQUIRED: '素材上传未完成，请重试后保存',
        FASHION_POST_MEDIA_INVALID: '素材暂存已失效，请重新选择素材',
        FASHION_POST_VIDEO_POSTER_INVALID: '视频封面已失效，请重新选择封面'
      };
      const message = messages[error && error.message] || (error && error.status === 401 ? '请先登录 RUDA 账户后再保存草稿' : '草稿保存失败，请检查网络后重试');
      this.setData({ uploadError: message });
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this._draftSaveLock = false;
      this.setData({ draftSaving: false });
    }
  },

  openComposer() {
    if (this._draftRestorePending) {
      wx.showToast({ title: '正在恢复草稿，请稍后再试', icon: 'none' });
      return;
    }
    this.pauseActiveVideo();
    const retainedDraft = this.data.publicationResult || this.data.draftMedia.length || this.data.postTitle || this.data.postText || this.data.postHashtags.length;
    if (retainedDraft) {
      this.setData({
        composerOpen: true,
        composerStep: this.data.publicationResult ? 'submitted' : (this.data.draftMedia.length ? 'preview' : 'capture'),
        uploadError: ''
      });
      if (!this._postIdempotencyKey) this._postIdempotencyKey = createIdempotencyKey();
      return;
    }
    this._postSubmitting = false;
    this._serverDraftId = '';
    this.setData({
      composerOpen: true,
      composerStep: 'capture',
      publicationResult: null,
      draftMedia: [],
      activeMediaIndex: 0,
      coverMediaIndex: 0,
      draftRestoreWarning: '',
      postTitle: '',
      postText: '',
      postHashtags: [],
      hashtagDraft: '',
      postCategoryIndex: 0,
      postCityIndex: 0,
      postSeasonIndex: 0,
      selectedProduct: null,
      postVisibilityIndex: 0,
      commentsEnabled: true,
      rightsConfirmed: false,
      postSubmitting: false,
      uploadProgress: 0,
      uploadCurrentLabel: '',
      uploadError: ''
    });
    this._postIdempotencyKey = createIdempotencyKey();
  },

  closeComposer() {
    if (!this.data.postSubmitting && !this.data.draftSaving) {
      if (this.data.publicationResult) {
        this.finishPublishing();
        return;
      }
      this.persistDraftWhenFilesReady();
      this.setData({ composerOpen: false, uploadError: '' }, () => this.resumeFeedVideo());
    }
  },

  finishPublishing() {
    const publicationResult = this.data.publicationResult;
    if (!publicationResult) return;
    if (this._draftAutosaveTimer) clearTimeout(this._draftAutosaveTimer);
    this._draftAutosaveTimer = null;
    const openPublishedPost = publicationResult.status === 'approved' && publicationResult.postId;
    try {
      wx.removeStorageSync(FASHION_DRAFT_STORAGE_KEY);
    } catch (error) {
      console.warn('[mini-fashion-draft-clear]', error);
    }
    if (this._serverDraftId) {
      const draftId = this._serverDraftId;
      this._serverDraftId = '';
      void deleteFashionDraft(draftId)
        .then(() => this.loadServerDrafts())
        .catch(error => console.warn('[mini-fashion-draft-cleanup]', error));
    }
    this._requestedPostId = openPublishedPost ? publicationResult.postId : '';
    this.setData({
      composerOpen: false,
      browseView: openPublishedPost ? 'feed' : 'grid',
      composerStep: 'capture',
      publicationResult: null,
      draftMedia: [],
      activeMediaIndex: 0,
      coverMediaIndex: 0,
      draftRestoreWarning: '',
      postTitle: '',
      postText: '',
      postHashtags: [],
      hashtagDraft: '',
      selectedProduct: null,
      postVisibilityIndex: 0,
      commentsEnabled: true,
      rightsConfirmed: false,
      uploadProgress: 0,
      uploadCurrentLabel: '',
      uploadError: ''
    }, () => {
      this.setData({
        mode: 'featured',
        categoryIndex: 0,
        cityIndex: 0,
        activeFeedIndex: 0,
        magazineScrollTop: 0
      }, () => {
        const tabBar = this.getTabBar && this.getTabBar();
        if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: Boolean(openPublishedPost) });
        this.loadFeed(true);
        this.resumeFeedVideo();
      });
    });
  },

  onChoosePostMedia(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
    const requestedType = String(dataset.type || 'image');
    const requestedSource = String(dataset.source || 'album');
    const mediaType = requestedType === 'video' ? ['video'] : ['image'];
    const remaining = MAX_POST_MEDIA_COUNT - this.data.draftMedia.length;
    if (remaining <= 0) {
      wx.showToast({ title: '一条作品最多添加 8 个素材', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: Math.min(requestedType === 'video' || requestedSource === 'camera' ? 1 : remaining, 9),
      mediaType,
      sourceType: [requestedSource === 'camera' ? 'camera' : 'album'],
      ...(requestedType === 'video' && requestedSource === 'camera' ? { maxDuration: 60, camera: 'back' } : {}),
      success: async result => {
        const selectedFiles = result.tempFiles || [];
        const additions = [];
        try {
          for (const file of selectedFiles) {
            const selected = getSelectedMediaInfo(file);
            if (!selected) throw new Error('仅支持 JPG、PNG、WebP 图片及 MP4、WebM、MOV 视频');
            if (!selected.size) selected.size = await getLocalFileSize(selected.filePath);
            if (!selected.size || selected.size > MAX_POST_MEDIA_FILE_BYTES) {
              throw new Error('单个素材不能超过 20 MB');
            }
            if (selected.type === 'video' && selected.duration > 180) {
              throw new Error('视频时长不能超过 3 分钟');
            }
            if (selected.type === 'video' && (!Number.isFinite(selected.duration) || selected.duration < 0.25)) {
              throw new Error('无法读取视频时长，或视频短于最小时长');
            }
            const posterSize = selected.posterPath ? await getLocalFileSize(selected.posterPath) : 0;
            if (posterSize > MAX_POST_MEDIA_FILE_BYTES) {
              throw new Error('视频封面文件过大，请重新选择视频');
            }
            additions.push({
              id: createIdempotencyKey(),
              ...selected,
              trimStartSeconds: 0,
              trimEndSeconds: selected.duration,
              muted: false,
              sizeLabel: formatMediaSize(selected.size),
              durationLabel: selected.type === 'video' ? formatMediaDuration(selected.duration) : '',
              posterSize,
              uploadToken: '',
              posterToken: ''
            });
          }
          const combined = this.data.draftMedia.concat(additions);
          const totalBytes = combined.reduce((total, media) => total + media.size + media.posterSize, 0);
          if (totalBytes > MAX_POST_MEDIA_TOTAL_BYTES) {
            throw new Error('所有素材和封面合计不能超过 50 MB');
          }
          this.setData({
            draftMedia: combined,
            activeMediaIndex: Math.max(0, combined.length - additions.length),
            composerStep: 'preview',
            uploadError: ''
          });
        } catch (error) {
          wx.showToast({ title: error.message || '无法添加所选素材', icon: 'none' });
        }
      },
      fail: error => {
        if (error && error.errMsg && error.errMsg.indexOf('cancel') >= 0) return;
        wx.showToast({ title: '选择素材失败，请检查相册或相机权限', icon: 'none' });
      }
    });
  },

  selectDraftMedia(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < this.data.draftMedia.length) {
      this.setData({ activeMediaIndex: index });
    }
  },

  onDraftMediaSwipe(event) {
    const index = Number(event.detail.current);
    if (Number.isInteger(index) && index >= 0 && index < this.data.draftMedia.length) {
      this.setData({ activeMediaIndex: index });
    }
  },

  onVideoTrimChange(event) {
    if (this.data.postSubmitting) return;
    const index = Number(event.currentTarget.dataset.index);
    const edge = String(event.currentTarget.dataset.edge || '');
    const value = Number(event.detail.value);
    const current = this.data.draftMedia[index];
    if (!current || current.type !== 'video' || !Number.isFinite(value) || !['start', 'end'].includes(edge)) return;
    const draftMedia = this.data.draftMedia.slice();
    const media = Object.assign({}, current);
    if (edge === 'start') {
      media.trimStartSeconds = Number(Math.min(Math.max(0, value), media.trimEndSeconds - 0.25).toFixed(1));
    } else {
      media.trimEndSeconds = Number(Math.max(Math.min(value, media.duration), media.trimStartSeconds + 0.25).toFixed(1));
    }
    draftMedia[index] = media;
    this.setData({ draftMedia });
    if (index === this.data.activeMediaIndex && this.data.composerStep === 'preview') {
      const context = wx.createVideoContext('fashion-composer-video', this);
      context.seek(media.trimStartSeconds);
    }
    this.scheduleComposerDraftSnapshot();
  },

  onComposerVideoTimeUpdate(event) {
    const media = this.data.draftMedia[this.data.activeMediaIndex];
    const currentTime = Number(event.detail && event.detail.currentTime);
    if (!media || media.type !== 'video' || !Number.isFinite(currentTime)) return;
    if (currentTime < media.trimStartSeconds || currentTime >= media.trimEndSeconds) {
      const context = wx.createVideoContext('fashion-composer-video', this);
      context.seek(media.trimStartSeconds);
      if (currentTime >= media.trimEndSeconds) context.pause();
    }
  },

  onVideoMuteChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const media = this.data.draftMedia[index];
    if (!media || media.type !== 'video' || this.data.postSubmitting) return;
    const draftMedia = this.data.draftMedia.slice();
    draftMedia[index] = Object.assign({}, media, { muted: Boolean(event.detail.value) });
    this.setData({ draftMedia });
    this.scheduleComposerDraftSnapshot();
  },

  returnToCapture() {
    if (!this.data.postSubmitting) this.setData({ composerStep: 'capture' });
  },

  chooseVideoPoster(event) {
    const index = Number(event.currentTarget.dataset.index);
    const media = this.data.draftMedia[index];
    if (!media || media.type !== 'video' || this.data.postSubmitting) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: async result => {
        const cover = result.tempFiles && result.tempFiles[0];
        const filePath = cover && cover.tempFilePath;
        if (!filePath) return;
        try {
          const size = Number(cover.size || await getLocalFileSize(filePath));
          if (size > MAX_POST_MEDIA_FILE_BYTES) {
            wx.showToast({ title: '封面图片不能超过 20 MB', icon: 'none' });
            return;
          }
          const draftMedia = this.data.draftMedia.slice();
          draftMedia[index] = Object.assign({}, draftMedia[index], {
            posterPath: filePath,
            posterSize: size,
            posterToken: ''
          });
          const totalBytes = draftMedia.reduce((total, asset) => total + asset.size + asset.posterSize, 0);
          if (totalBytes > MAX_POST_MEDIA_TOTAL_BYTES) {
            wx.showToast({ title: '素材和封面总大小不能超过 50 MB', icon: 'none' });
            return;
          }
          this.setData({ draftMedia, uploadError: '' });
        } catch (error) {
          wx.showToast({ title: error.message || '无法读取封面图片', icon: 'none' });
        }
      },
      fail: error => {
        if (error && error.errMsg && error.errMsg.indexOf('cancel') >= 0) return;
        wx.showToast({ title: '选择封面失败，请检查相册权限', icon: 'none' });
      }
    });
  },

  setPhotoCover(event) {
    if (this.data.postSubmitting) return;
    const index = Number(event.currentTarget.dataset.index);
    const media = this.data.draftMedia[index];
    if (!media || media.type !== 'image') return;
    this.setData({ coverMediaIndex: index });
    this.scheduleComposerDraftSnapshot();
  },

  removeDraftMedia(event) {
    if (this.data.postSubmitting) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.draftMedia.length) return;
    const draftMedia = this.data.draftMedia.filter((_media, itemIndex) => itemIndex !== index);
    const coverMediaIndex = this.data.coverMediaIndex === index
      ? Math.min(index, Math.max(draftMedia.length - 1, 0))
      : this.data.coverMediaIndex > index ? this.data.coverMediaIndex - 1 : this.data.coverMediaIndex;
    this.setData({
      draftMedia,
      coverMediaIndex,
      activeMediaIndex: Math.min(this.data.activeMediaIndex, Math.max(draftMedia.length - 1, 0)),
      composerStep: draftMedia.length ? this.data.composerStep : 'capture',
      uploadError: ''
    });
  },

  moveDraftMedia(event) {
    if (this.data.postSubmitting) return;
    const index = Number(event.currentTarget.dataset.index);
    const direction = Number(event.currentTarget.dataset.direction);
    const target = index + direction;
    if (!Number.isInteger(index) || target < 0 || target >= this.data.draftMedia.length) return;
    const draftMedia = this.data.draftMedia.slice();
    [draftMedia[index], draftMedia[target]] = [draftMedia[target], draftMedia[index]];
    const coverMediaIndex = this.data.coverMediaIndex === index
      ? target
      : this.data.coverMediaIndex === target ? index : this.data.coverMediaIndex;
    this.setData({ draftMedia, coverMediaIndex, activeMediaIndex: target, uploadError: '' });
  },

  continueToPostDetails() {
    if (this.data.postSubmitting || this.data.draftSaving || this._draftSaveLock) return;
    if (!this.data.draftMedia.length) {
      wx.showToast({ title: '请先选择图片或视频', icon: 'none' });
      return;
    }
    this._draftSaveLock = true;
    this.setData({ draftSaving: true });
    this.persistComposerDraftFiles().then(() => {
      this.setData({ composerStep: 'details', uploadError: '', draftRestoreWarning: '' });
    }).catch(error => {
      console.error('[mini-fashion-draft-prepare]', error);
      wx.showToast({ title: '素材暂存失败，请检查设备存储空间后重试', icon: 'none' });
    }).finally(() => {
      this._draftSaveLock = false;
      this.setData({ draftSaving: false });
    });
  },

  returnToMediaSelection() {
    if (!this.data.postSubmitting) this.setData({ composerStep: 'preview' });
  },

  onComposerInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'title') this.setData({ postTitle: event.detail.value });
    if (field === 'text') this.setData({ postText: event.detail.value });
    if (field === 'hashtags') this.setData({ hashtagDraft: event.detail.value });
    this.scheduleComposerDraftSnapshot();
  },

  addPostHashtag() {
    const additions = this.data.hashtagDraft.split(/[\s,，]+/).map(tag => tag.trim().replace(/^#+/, '')).filter(Boolean);
    const tags = this.data.postHashtags.slice();
    additions.forEach(tag => {
      if (tags.length < 8 && !tags.some(existing => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags.push(tag);
    });
    this.setData({ postHashtags: tags, hashtagDraft: '' });
    this.scheduleComposerDraftSnapshot();
  },

  removePostHashtag(event) {
    const tag = event.currentTarget.dataset.tag;
    this.setData({ postHashtags: this.data.postHashtags.filter(item => item !== tag) });
    this.scheduleComposerDraftSnapshot();
  },

  onPostCategoryChange(event) {
    this.setData({ postCategoryIndex: Number(event.detail.value) });
    this.scheduleComposerDraftSnapshot();
  },

  onPostCityChange(event) {
    this.setData({ postCityIndex: Number(event.detail.value) });
    this.scheduleComposerDraftSnapshot();
  },

  onPostSeasonChange(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= seasonOptions.length) return;
    this.setData({ postSeasonIndex: index });
    this.scheduleComposerDraftSnapshot();
  },

  onPostVisibilityChange(event) {
    const postVisibilityIndex = Number(event.detail.value);
    if (!Number.isInteger(postVisibilityIndex) || postVisibilityIndex < 0 || postVisibilityIndex >= postVisibilityValues.length) return;
    this.setData({ postVisibilityIndex });
    this.scheduleComposerDraftSnapshot();
  },

  onCommentsEnabledChange(event) {
    this.setData({ commentsEnabled: Boolean(event.detail.value) });
    this.scheduleComposerDraftSnapshot();
  },

  openProductPicker() {
    this._productSearchRequest = (this._productSearchRequest || 0) + 1;
    this.setData({
      productPickerOpen: true,
      productSearch: '',
      productResults: [],
      productSearchLoading: false,
      productSearchError: ''
    });
  },

  closeProductPicker() {
    this._productSearchRequest = (this._productSearchRequest || 0) + 1;
    if (this._productSearchTimer) {
      clearTimeout(this._productSearchTimer);
      this._productSearchTimer = null;
    }
    this.setData({ productPickerOpen: false, productSearchLoading: false });
  },

  onProductSearchInput(event) {
    const productSearch = String(event.detail && event.detail.value || '');
    this._productSearchRequest = (this._productSearchRequest || 0) + 1;
    this.setData({ productSearch, productSearchError: '' });
    if (this._productSearchTimer) clearTimeout(this._productSearchTimer);
    if (productSearch.trim().length < 2) {
      this._productSearchRequest = (this._productSearchRequest || 0) + 1;
      this.setData({ productResults: [], productSearchLoading: false });
      return;
    }
    this._productSearchTimer = setTimeout(() => {
      this._productSearchTimer = null;
      this.searchFashionProducts();
    }, 350);
  },

  clearProductSearch() {
    this._productSearchRequest = (this._productSearchRequest || 0) + 1;
    if (this._productSearchTimer) {
      clearTimeout(this._productSearchTimer);
      this._productSearchTimer = null;
    }
    this.setData({
      productSearch: '',
      productResults: [],
      productSearchLoading: false,
      productSearchError: ''
    });
  },

  async searchFashionProducts() {
    const query = this.data.productSearch.trim();
    if (query.length < 2 || !this.data.productPickerOpen) return;
    const requestId = (this._productSearchRequest || 0) + 1;
    this._productSearchRequest = requestId;
    this.setData({ productSearchLoading: true, productSearchError: '' });
    try {
      const result = await searchFashionCreatorProducts(query);
      if (requestId !== this._productSearchRequest || !this.data.productPickerOpen) return;
      if (result && result.manageable === false) {
        this.setData({
          productResults: [],
          productSearchLoading: false,
          productSearchError: '当前账号未关联商家，无法关联商品；仍可发布普通作品'
        });
        return;
      }
      const products = (Array.isArray(result.products) ? result.products : []).map(product => Object.assign({}, product, {
        displayName: product.name || product.styleNo || '时尚商品',
        coverUrl: getAssetUrl(product.image),
        displayPrice: product.retailPrice ? `€${Number(product.retailPrice).toFixed(0)}` : ''
      }));
      this.setData({ productResults: products, productSearchLoading: false });
    } catch (error) {
      if (requestId !== this._productSearchRequest || !this.data.productPickerOpen) return;
      this.setData({
        productResults: [],
        productSearchLoading: false,
        productSearchError: error.message || '商品搜索失败，请重试'
      });
    }
  },

  retryFashionProductSearch() {
    this.searchFashionProducts();
  },

  selectFashionProduct(event) {
    const productId = String(event.currentTarget.dataset.id || '');
    const product = this.data.productResults.find(item => item.id === productId);
    if (!product) return;
    const selectedProduct = {
      id: product.id,
      displayName: product.displayName,
      name: product.name,
      name_zh: product.name_zh,
      brand: product.brand,
      styleNo: product.styleNo,
      coverUrl: product.coverUrl,
      wholesalePrice: product.wholesalePrice
    };
    this.setData({ selectedProduct, productPickerOpen: false });
    this.scheduleComposerDraftSnapshot();
  },

  removeFashionProduct() {
    this.setData({ selectedProduct: null });
    this.scheduleComposerDraftSnapshot();
  },

  openLinkedProduct(event) {
    const productId = String(event.currentTarget.dataset.productId || '');
    const postId = String(event.currentTarget.dataset.postId || '');
    if (!productId) return;
    if (postId) {
      recordFashionProductClick(postId, productId).catch(() => undefined);
    }
    wx.navigateTo({ url: `/pages/product/index?productId=${encodeURIComponent(productId)}` });
  },

  onMerchantTap(event) {
    const merchant = this.data.merchants[Number(event.currentTarget.dataset.index)];
    if (!merchant) return;
    const query = merchant.storeSlug
      ? 'storeSlug=' + encodeURIComponent(merchant.storeSlug)
      : 'shopId=' + encodeURIComponent(merchant.id);
    wx.navigateTo({ url: '/pages/store/index?' + query });
  },

  openCreator(event) {
    const item = this.data.visibleItems.find(entry => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (this.isInteractionBlocked(item)) {
      wx.showToast({ title: '该作品暂无可查看的创作者主页', icon: 'none' });
      return;
    }
    if (item.storeSlug) {
      wx.navigateTo({ url: `/pages/store/index?storeSlug=${encodeURIComponent(item.storeSlug)}` });
      return;
    }
    if (item.merchantId && item.merchantId !== 'public-fashion') {
      wx.navigateTo({ url: `/pages/store/index?shopId=${encodeURIComponent(item.merchantId)}` });
      return;
    }
    if (!item.creatorId) {
      wx.showToast({ title: '该作品暂无公开创作者主页', icon: 'none' });
      return;
    }
    this.pauseActiveVideo();
    this._creatorProfileRequest = (this._creatorProfileRequest || 0) + 1;
    const requestId = this._creatorProfileRequest;
    this.setData({
      creatorProfileOpen: true,
      creatorProfileLoading: true,
      creatorProfileError: '',
      creatorProfile: null,
      creatorProfileColumns: [[], []]
    });
    getFashionCreatorProfile(item.creatorId).then(result => {
      if (requestId !== this._creatorProfileRequest || !this.data.creatorProfileOpen) return;
      const creator = result && result.creator;
      if (!creator || creator.id !== item.creatorId) throw new Error('创作者资料暂不可用');
      const posts = (Array.isArray(creator.posts) ? creator.posts : []).map(presentPost);
      this.setData({
        creatorProfile: Object.assign({}, creator, {
          avatarUrl: getAssetUrl(creator.avatarUrl),
          initial: String(creator.displayName || 'R')[0],
          posts
        }),
        creatorProfileColumns: buildMagazineColumns(posts),
        creatorProfileLoading: false
      });
    }).catch(error => {
      if (requestId !== this._creatorProfileRequest || !this.data.creatorProfileOpen) return;
      this.setData({
        creatorProfileError: error.message || '创作者资料暂时无法加载',
        creatorProfileLoading: false
      });
    });
  },

  closeCreatorProfile() {
    this._creatorProfileRequest = (this._creatorProfileRequest || 0) + 1;
    this.setData({
      creatorProfileOpen: false,
      creatorProfileLoading: false,
      creatorProfileError: '',
      creatorProfile: null,
      creatorProfileColumns: [[], []]
    }, () => this.resumeFeedVideo());
  },

  retryCreatorProfile() {
    const creatorId = this.data.creatorProfile && this.data.creatorProfile.id;
    if (!creatorId || this.data.creatorProfileLoading) return;
    const item = this.data.items.find(post => post.creatorId === creatorId);
    if (!item) return;
    this.openCreator({ currentTarget: { dataset: { id: item.id } } });
  },

  async toggleCreatorProfileFollow() {
    const creator = this.data.creatorProfile;
    const lockKey = creator && `follow:${creator.id}`;
    if (!creator || !lockKey || this._socialLocks.has(lockKey)) return;
    this._socialLocks.add(lockKey);
    try {
      if (!(await this.ensureAccount())) return;
      if (!this.data.creatorProfile || this.data.creatorProfile.id !== creator.id) return;
      const result = await followFashionCreator(creator.id);
      if (!this.data.creatorProfile || this.data.creatorProfile.id !== creator.id) return;
      const creatorProfile = Object.assign({}, this.data.creatorProfile, {
        following: result.following,
        followersCount: result.followersCount
      });
      this.setData({ creatorProfile });
      this.updateSocial(creator.id, { following: result.following, followersCount: result.followersCount });
    } catch (error) {
      wx.showToast({ title: error.message || '关注失败', icon: 'none' });
    } finally {
      this._socialLocks.delete(lockKey);
    }
  },

  async toggleCreatorProfileBlock() {
    const creator = this.data.creatorProfile;
    if (!creator || creator.isSelf) return;
    if (!(await this.ensureAccount())) return;
    const blocking = !creator.blocked;
    if (blocking) {
      const confirmed = await new Promise(resolve => {
        wx.showModal({
          title: '屏蔽该创作者',
          content: '屏蔽后，对方的内容将不再出现在你的信息流中。',
          success: result => resolve(Boolean(result.confirm)),
          fail: () => resolve(false)
        });
      });
      if (!confirmed) return;
    }
    try {
      if (blocking) await blockFashionCreator(creator.id);
      else await unblockFashionCreator(creator.id);
      if (blocking) {
        this.setData({
          creatorProfileOpen: false,
          creatorProfile: null,
          creatorProfileColumns: [[], []]
        }, () => {
          this.loadFeed(true);
          wx.showToast({ title: '已屏蔽该创作者', icon: 'success' });
        });
      } else {
        this.setData({ creatorProfile: Object.assign({}, creator, { blocked: false }) });
        wx.showToast({ title: '已取消屏蔽', icon: 'success' });
      }
    } catch (error) {
      wx.showToast({ title: error && error.message || '操作失败', icon: 'none' });
    }
  },

  openCreatorProfilePost(event) {
    const postId = String(event.currentTarget.dataset.id || '');
    if (!postId || this.data.loading || this.data.loadingMore) return;
    this._creatorProfileRequest = (this._creatorProfileRequest || 0) + 1;
    this._requestedPostId = postId;
    this.pauseActiveVideo();
    this.setData({
      creatorProfileOpen: false,
      creatorProfile: null,
      creatorProfileColumns: [[], []],
      browseView: 'feed',
      mode: 'featured',
      categoryIndex: 0,
      cityIndex: 0,
      activeFeedIndex: 0,
      galleryIndices: {}
    }, () => {
      const tabBar = this.getTabBar && this.getTabBar();
      if (tabBar) tabBar.setData({ selected: 3, fashionImmersive: true });
      this.loadFeed(true);
    });
  },

  onShareAppMessage(event) {
    const postId = event && event.target && event.target.dataset && event.target.dataset.postId;
    const item = this.data.visibleItems.find(entry => entry.id === postId);
    return {
      title: (item && item.displayTitle) || 'RUDA 时尚灵感',
      path: `/pages/fashion/index${postId ? `?postId=${encodeURIComponent(postId)}` : ''}`
    };
  },

  onRightsChange(event) {
    this.setData({ rightsConfirmed: Boolean(event.detail.value.length) });
    this.scheduleComposerDraftSnapshot();
  },

  async submitPost() {
    if (this.data.postSubmitting || this.data.draftSaving || this._postSubmitLock) return;
    this._postSubmitLock = true;
    try {
      if (!this.data.draftMedia.length) {
        wx.showToast({ title: '请先选择图片或视频', icon: 'none' });
        return;
      }
      if (!this.data.rightsConfirmed) {
        wx.showToast({ title: '请确认你拥有这些素材的使用权', icon: 'none' });
        return;
      }
      const missingPosterIndex = this.data.draftMedia.findIndex(media => media.type === 'video' && !media.posterPath && !media.posterToken);
      if (missingPosterIndex >= 0) {
        this.setData({ composerStep: 'preview', activeMediaIndex: missingPosterIndex });
        wx.showToast({ title: '请先为视频选择封面', icon: 'none' });
        return;
      }
      const totalBytes = this.data.draftMedia.reduce((total, media) => total + media.size + media.posterSize, 0);
      if (!Number.isFinite(totalBytes) || totalBytes <= 0 || totalBytes > MAX_POST_MEDIA_TOTAL_BYTES
        || this.data.draftMedia.some(media => !Number.isFinite(media.size) || media.size <= 0
          || (media.type === 'video' && (!media.posterSize || media.posterSize <= 0)))) {
        wx.showToast({ title: '素材大小信息无效，请重新选择素材或视频封面', icon: 'none' });
        return;
      }
      this.setData({ postSubmitting: true, uploadProgress: 0, uploadError: '', uploadCurrentLabel: '验证发布权限' });
      this.setData({ uploadCurrentLabel: '保存草稿并准备素材' });
      if (!this._postIdempotencyKey) this._postIdempotencyKey = createIdempotencyKey();
      await this.persistComposerDraftFiles();
      if (!(await this.ensureAccount())) return;
      this.setData({ uploadCurrentLabel: '准备素材' });
      let completedBytes = this.data.draftMedia.reduce((total, media) => (
        total + (media.uploadToken ? media.size : 0) + (media.posterToken ? media.posterSize : 0)
      ), 0);
      const draftMedia = this.data.draftMedia.map(media => Object.assign({}, media));
      const updateUploadProgress = (label, assetBytes, event) => {
        const sent = Number(event && event.totalBytesSent || 0);
        const expected = Number(event && event.totalBytesExpectedToSend || assetBytes || 1);
        const progress = totalBytes > 0 ? Math.min(99, Math.round(((completedBytes + assetBytes * Math.min(1, sent / expected)) / totalBytes) * 100)) : 0;
        this.setData({ uploadProgress: progress, uploadCurrentLabel: label });
      };
      for (let index = 0; index < draftMedia.length; index += 1) {
        const media = draftMedia[index];
        if (!media.uploadToken) {
          const label = `上传素材 ${index + 1}/${draftMedia.length}`;
          this.setData({ uploadCurrentLabel: label });
          const result = await uploadFashionPostAsset(media.filePath, {
            type: media.type,
            kind: 'media',
            filename: media.name
          }, event => updateUploadProgress(label, media.size, event));
          media.uploadToken = result.uploadToken;
          completedBytes += media.size;
          this.setData({ draftMedia: draftMedia.slice() });
          this.persistComposerDraftSnapshot();
        }
        if (media.type === 'video' && !media.posterToken) {
          const label = `上传封面 ${index + 1}/${draftMedia.length}`;
          const result = await uploadFashionPostAsset(media.posterPath, {
            type: 'video',
            kind: 'poster',
            filename: getBaseName(media.posterPath)
          }, event => updateUploadProgress(label, media.posterSize, event));
          media.posterToken = result.uploadToken;
          completedBytes += media.posterSize;
          this.setData({ draftMedia: draftMedia.slice() });
          this.persistComposerDraftSnapshot();
        }
      }
      this.setData({ uploadProgress: 99, uploadCurrentLabel: '正在提交审核' });
      const manifest = draftMedia.map(media => ({
        type: media.type,
        name: media.name,
        uploadToken: media.uploadToken,
        ...(media.type === 'video' ? {
          posterToken: media.posterToken,
          ...(media.trimStartSeconds > 0 || media.trimEndSeconds < media.duration || media.muted
            ? {
              trimStartSeconds: media.trimStartSeconds,
              trimEndSeconds: media.trimEndSeconds,
              muted: media.muted === true
            }
            : {})
        } : {})
      }));
      const result = await submitFashionMixedPost({
        idempotencyKey: this._postIdempotencyKey,
        manifest,
        coverMediaIndex: this.data.coverMediaIndex,
        title: this.data.postTitle.trim(),
        text: this.data.postText.trim(),
        category: (this.data.postCategories || postCategories)[this.data.postCategoryIndex],
        city: cities[this.data.postCityIndex] === '全部地区' ? '' : cities[this.data.postCityIndex],
        season: this.data.postSeasonIndex > 0 ? fashionSeasons[this.data.postSeasonIndex - 1] : '',
        productIds: this.data.selectedProduct ? [this.data.selectedProduct.id] : [],
        visibility: postVisibilityValues[this.data.postVisibilityIndex] || 'public',
        commentsEnabled: this.data.commentsEnabled,
        hashtags: JSON.stringify(this.data.postHashtags),
        rightsConfirmed: 'true'
      });
      if (!result || !result.post || typeof result.post.id !== 'string' || !result.post.id
        || !['pending', 'approved', 'unpublished'].includes(result.post.publicationStatus)) {
        throw new Error('INVALID_API_RESPONSE');
      }
      const publicationStatus = result.post.publicationStatus;
      this.setData({
        composerStep: 'submitted',
        publicationResult: {
          status: publicationStatus,
          title: this.data.postTitle.trim(),
          postId: result.post.id
        },
        postSubmitting: false,
        uploadProgress: 100,
        uploadCurrentLabel: ''
      });
      this._postIdempotencyKey = '';
      if (this._serverDraftId) {
        const publishedDraftId = this._serverDraftId;
        this._serverDraftId = '';
        void deleteFashionDraft(publishedDraftId)
          .then(() => this.loadServerDrafts())
          .catch(error => console.warn('[mini-fashion-draft-cleanup]', error));
      }
      try {
        this.persistComposerDraftSnapshot();
      } catch (error) {
        console.warn('[mini-fashion-draft-submit-result-save]', error);
      }
      wx.showToast({
        title: publicationStatus === 'approved'
          ? '作品已发布'
          : publicationStatus === 'unpublished' ? '作品当前未公开' : '作品已提交审核',
        icon: publicationStatus === 'unpublished' ? 'none' : 'success'
      });
    } catch (error) {
      const errorCode = error && error.message || '';
      if (errorCode === 'FASHION_POST_MEDIA_INVALID' || errorCode === 'FASHION_POST_VIDEO_POSTER_INVALID') {
        const hadRemoteMedia = this.data.draftMedia.some(media => media.remote);
        const mediaWithoutExpiredTokens = this.data.draftMedia
          .filter(media => !media.remote)
          .map(media => Object.assign({}, media, {
            uploadToken: '',
            posterToken: ''
          }));
        const nextData = { draftMedia: mediaWithoutExpiredTokens };
        if (hadRemoteMedia) {
          nextData.composerStep = mediaWithoutExpiredTokens.length ? this.data.composerStep : 'capture';
          nextData.draftRestoreWarning = '云端素材已过期，请重新选择素材后上传';
          nextData.coverMediaIndex = 0;
          nextData.activeMediaIndex = 0;
        }
        this.setData(nextData);
      }
      const messages = {
        NETWORK_ERROR: '网络中断，已保留已上传素材，点击重试即可继续',
        REQUEST_TIMEOUT: '上传超时，已保留已上传素材，请重试',
        FASHION_DRAFT_FILE_SAVE_FAILED: '无法将素材保存到本机，请检查设备存储空间后重试',
        INVALID_API_RESPONSE: '服务器没有返回有效的上传结果，请重试；不会重复创建作品',
        FASHION_POST_UPLOAD_IN_PROGRESS: '作品正在提交，请稍后重试',
        FASHION_POST_MEDIA_TOTAL_TOO_LARGE: '素材总大小超过服务端限制',
        FASHION_POST_MEDIA_TOO_LARGE: '单个素材超过 20 MB，请压缩后重新选择',
        FASHION_POST_MEDIA_INVALID: '素材暂存已失效或格式无效，请重新选择素材后重试',
        FASHION_POST_VIDEO_INVALID: '视频格式或时长不符合要求',
        FASHION_POST_VIDEO_POSTER_INVALID: '视频封面无效，请重新选择封面',
        FASHION_POST_VIDEO_POSTER_TOO_LARGE: '视频封面超过服务端限制，请更换较小的图片',
        FASHION_POST_PRODUCT_INVALID: '关联商品信息无效，请重新选择商品',
        FASHION_POST_PRODUCT_NOT_AVAILABLE: '关联商品已下架或暂不可用，请重新选择商品',
        FASHION_POST_PRIVATE_MEDIA_STORAGE_REQUIRED: '当前媒体存储未启用私有存储，暂不能发布关注者或仅自己可见的作品',
        FASHION_POST_VISIBILITY_INVALID: '作品可见范围无效，请重新选择',
        FASHION_POST_COMMENTS_SETTING_INVALID: '评论设置无效，请重试',
        FASHION_POST_VIDEO_EDIT_INVALID: '视频裁剪设置无效，请检查起止位置',
        FASHION_POST_PROCESSED_VIDEO_TOO_LARGE: '处理后的视频超过服务端限制，请缩短视频或压缩素材',
        FASHION_VIDEO_PROCESSOR_UNAVAILABLE: '视频处理服务暂不可用，请稍后重试',
        FASHION_VIDEO_TRIM_RANGE_INVALID: '视频裁剪范围无效，请重新设置'
      };
      const message = messages[errorCode] || errorCode || '上传或发布失败，请检查网络后重试';
      this.setData({ uploadError: message });
      wx.showToast({ title: message, icon: 'none', duration: 3000 });
    } finally {
      this.setData({ postSubmitting: false });
      this._postSubmitLock = false;
    }
  }
});
