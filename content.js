(() => {
  const DEFAULTS = {
    enabled: true,
    mode: 'blackout',
    blockedChannels: [],
    customImage: ''
  };

  let settings = { ...DEFAULTS };
  let scheduled = false;

  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-rich-grid-media',
    'yt-lockup-view-model',
    'ytd-post-renderer',
    'ytd-backstage-post-thread-renderer',
    'ytd-backstage-post-renderer'
  ];

  const OUTER_CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-post-renderer',
    'ytd-backstage-post-thread-renderer',
    'ytd-backstage-post-renderer',
    'yt-lockup-view-model',
    'ytd-rich-grid-media'
  ].join(',');

  function normalizeKey(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (!parts.length) return '';

      if (parts[0].startsWith('@')) return `/${parts[0]}`.toLowerCase();
      if (['channel', 'c', 'user'].includes(parts[0]) && parts[1]) {
        return `/${parts[0]}/${parts[1]}`.toLowerCase();
      }
      return '';
    } catch {
      return String(value).trim().toLowerCase();
    }
  }

  function labelFor(card) {
    const tag = card.tagName.toLowerCase();
    return tag.includes('post') || card.querySelector('ytd-backstage-post-renderer')
      ? '차단된 채널의 게시물'
      : (tag.includes('reel') || tag.includes('shorts'))
        ? '차단된 채널의 Shorts'
        : '차단된 채널의 콘텐츠';
  }

  function channelLinksIn(root) {
    if (!root?.querySelectorAll) return [];
    return [...root.querySelectorAll('a[href]')]
      .map(a => ({ a, key: normalizeKey(a.href || a.getAttribute('href')) }))
      .filter(item => item.key);
  }

  function findChannelKey(card) {
    const links = channelLinksIn(card);
    if (!links.length) return '';

    const preferred = links.find(({ a }) => {
      const hint = [
        a.id,
        a.className,
        a.getAttribute('aria-label'),
        a.closest('ytd-channel-name')?.id,
        a.closest('#channel-name')?.id,
        a.closest('[class*="channel"]')?.className,
        a.closest('[id*="channel"]')?.id,
        a.closest('[class*="author"]')?.className,
        a.closest('[id*="author"]')?.id,
        a.closest('[class*="byline"]')?.className,
        a.closest('[id*="byline"]')?.id
      ].filter(Boolean).join(' ');
      return /channel|author|byline|owner|avatar/i.test(hint);
    });

    return (preferred || links[0]).key;
  }

  function getChannelPageKey() {
    const path = location.pathname;
    if (!/^\/(?:@|channel\/|c\/|user\/)/i.test(path)) return '';
    return normalizeKey(location.href);
  }

  function isBlocked(key) {
    if (!key) return false;
    return settings.blockedChannels.some(item => normalizeKey(item.key || item) === key);
  }

  async function setBlocked(key, blocked) {
    if (!key) return;
    const existing = settings.blockedChannels.filter(x => normalizeKey(x.key || x) !== key);
    if (blocked) existing.push({ key, addedAt: new Date().toISOString() });
    settings.blockedChannels = existing;
    await chrome.storage.local.set({ blockedChannels: existing });
  }

  function applyMode(card) {
    card.classList.remove('bfy-hidden', 'bfy-censored', 'bfy-blur', 'bfy-image');
    card.style.removeProperty('--bfy-custom-image');

    if (settings.mode === 'hide') {
      card.classList.add('bfy-hidden');
      return;
    }

    card.classList.add('bfy-censored');
    card.dataset.bfyLabel = labelFor(card);

    if (settings.mode === 'blur') {
      card.classList.add('bfy-blur');
    } else if (settings.mode === 'image' && settings.customImage) {
      card.classList.add('bfy-image');
      const safe = settings.customImage.replace(/"/g, '%22');
      card.style.setProperty('--bfy-custom-image', `url("${safe}")`);
    }
  }

  function restore(card) {
    card.classList.remove('bfy-hidden', 'bfy-censored', 'bfy-blur', 'bfy-image');
    card.style.removeProperty('--bfy-custom-image');
    delete card.dataset.bfyLabel;
  }

  function addBlockButton(card, key) {
    if (!key || card.querySelector(':scope > .bfy-block-button')) return;
    card.classList.add('bfy-card');

    const btn = document.createElement('button');
    btn.className = 'bfy-block-button';
    btn.type = 'button';
    btn.textContent = '차단';
    btn.title = '이 채널을 Blackout 목록에 추가';
    btn.dataset.bfyKey = key;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      await setBlocked(key, true);
      scan();
    }, true);

    card.appendChild(btn);
  }

  function canonicalCard(card) {
    if (!(card instanceof Element)) return card;
    const outer = card.parentElement?.closest(OUTER_CARD_SELECTOR);
    return outer || card;
  }

  function processCard(rawCard) {
    if (!(rawCard instanceof HTMLElement)) return;
    const card = canonicalCard(rawCard);
    if (!(card instanceof HTMLElement)) return;

    const key = findChannelKey(card);
    if (!key) return;

    if (settings.enabled && isBlocked(key)) {
      card.querySelector(':scope > .bfy-block-button')?.remove();
      applyMode(card);
    } else {
      restore(card);
      addBlockButton(card, key);
    }
  }

  function processChannelLinkFallbacks(root = document) {
    const links = channelLinksIn(root);
    for (const { a } of links) {
      const card = a.closest(OUTER_CARD_SELECTOR);
      if (card) processCard(card);
    }
  }

  function findChannelHeaderTarget() {
    const selectors = [
      'yt-page-header-renderer #actions',
      'yt-page-header-renderer yt-flexible-actions-view-model',
      'ytd-c4-tabbed-header-renderer #buttons',
      '#channel-header-container #buttons',
      'yt-page-header-renderer'
    ];
    return selectors.map(s => document.querySelector(s)).find(Boolean) || null;
  }

  function updateChannelPageButton() {
    const key = getChannelPageKey();
    const existing = document.querySelector('.bfy-channel-block-button');

    if (!key) {
      existing?.remove();
      return;
    }

    const target = findChannelHeaderTarget();
    if (!target) return;

    let btn = existing;
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'bfy-channel-block-button';
      btn.type = 'button';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentKey = getChannelPageKey();
        if (!currentKey) return;
        await setBlocked(currentKey, !isBlocked(currentKey));
        updateChannelPageButton();
        scan();
      }, true);
    }

    if (btn.parentElement !== target) target.appendChild(btn);
    const blocked = isBlocked(key);
    btn.dataset.bfyKey = key;
    btn.dataset.blocked = blocked ? 'true' : 'false';
    btn.textContent = blocked ? '차단 해제' : '채널 차단';
    btn.title = blocked
      ? '이 채널을 Blackout 목록에서 제거'
      : '이 채널을 Blackout 목록에 추가';
  }

  function scan(root = document) {
    if (!settings.enabled) {
      document.querySelectorAll('.bfy-censored,.bfy-hidden').forEach(restore);
    }

    for (const selector of CARD_SELECTORS) {
      root.querySelectorAll?.(selector).forEach(processCard);
      if (root.matches?.(selector)) processCard(root);
    }

    processChannelLinkFallbacks(root);
    updateChannelPageButton();
  }

  function queueScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  async function loadSettings() {
    const saved = await chrome.storage.local.get(DEFAULTS);
    settings = { ...DEFAULTS, ...saved };
    scan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    queueScan();
  });

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', queueScan, true);
  window.addEventListener('popstate', queueScan, true);
  loadSettings();
})();
