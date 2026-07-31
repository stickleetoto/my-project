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
    'ytd-rich-grid-media',
    'ytd-rich-grid-slim-media',
    'yt-lockup-view-model',
    'yt-lockup-metadata-view-model',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-post-renderer',
    'ytd-backstage-post-thread-renderer',
    'ytd-backstage-post-renderer'
  ];

  const OUTER_CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-rich-grid-media',
    'ytd-rich-grid-slim-media',
    'yt-lockup-view-model',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-post-renderer',
    'ytd-backstage-post-thread-renderer',
    'ytd-backstage-post-renderer'
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

  function normalizeLabel(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
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
    return [...root.querySelectorAll('[href]')]
      .map(el => {
        const raw = el.href || el.getAttribute('href');
        return { el, key: normalizeKey(raw) };
      })
      .filter(item => item.key);
  }

  function keyFromSerializedCard(card) {
    const html = card?.innerHTML || '';
    if (!html) return '';

    const patterns = [
      /(?:https?:\\?\/\\?\/www\.youtube\.com)?\\?(\/@[A-Za-z0-9._-]+)/i,
      /\\?(\/channel\/[A-Za-z0-9_-]+)/i,
      /\\?(\/c\/[A-Za-z0-9._-]+)/i,
      /\\?(\/user\/[A-Za-z0-9._-]+)/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return normalizeKey(match[1].replace(/\\\//g, '/'));
    }
    return '';
  }

  function findChannelKey(card) {
    if (!card) return '';
    if (card.dataset?.bfyChannelKey) return normalizeKey(card.dataset.bfyChannelKey);

    const links = channelLinksIn(card);
    if (links.length) {
      const preferred = links.find(({ el }) => {
        const hint = [
          el.id,
          typeof el.className === 'string' ? el.className : '',
          el.getAttribute?.('aria-label'),
          el.closest?.('ytd-channel-name')?.id,
          el.closest?.('#channel-name')?.id,
          el.closest?.('[class*="channel"]')?.className,
          el.closest?.('[id*="channel"]')?.id,
          el.closest?.('[class*="author"]')?.className,
          el.closest?.('[id*="author"]')?.id,
          el.closest?.('[class*="byline"]')?.className,
          el.closest?.('[id*="byline"]')?.id,
          el.closest?.('[class*="metadata"]')?.className
        ].filter(Boolean).join(' ');
        return /channel|author|byline|owner|avatar|metadata/i.test(hint);
      });

      const key = (preferred || links[0]).key;
      if (key) {
        card.dataset.bfyChannelKey = key;
        return key;
      }
    }

    const serializedKey = keyFromSerializedCard(card);
    if (serializedKey) card.dataset.bfyChannelKey = serializedKey;
    return serializedKey;
  }

  function channelLabelFromCard(card) {
    if (!card?.querySelector) return '';
    if (card.dataset?.bfyChannelLabel) return card.dataset.bfyChannelLabel;

    const selectors = [
      'ytd-channel-name #text',
      '#channel-name #text',
      '#channel-name a',
      '#byline-container a',
      '#byline a',
      '.ytd-channel-name',
      '.yt-content-metadata-view-model__metadata-row:first-child a',
      '.yt-content-metadata-view-model__metadata-text:first-child',
      '[class*="channel-name"]',
      '[class*="byline"] a'
    ];

    for (const selector of selectors) {
      const el = card.querySelector(selector);
      const text = el?.textContent?.replace(/\s+/g, ' ').trim();
      if (text && text.length <= 120) {
        card.dataset.bfyChannelLabel = text;
        return text;
      }
    }
    return '';
  }

  function getChannelPageKey() {
    const path = location.pathname;
    if (!/^\/(?:@|channel\/|c\/|user\/)/i.test(path)) return '';
    return normalizeKey(location.href);
  }

  function getChannelPageLabel() {
    const selectors = [
      'yt-page-header-renderer h1',
      'yt-page-header-renderer #page-header span',
      'ytd-c4-tabbed-header-renderer #channel-name',
      '#channel-header-container #channel-name',
      'meta[property="og:title"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el?.content || el?.textContent;
      if (text?.trim()) return text.replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function blockedEntryFor(key, label = '') {
    const normalizedKey = normalizeKey(key);
    const normalizedLabel = normalizeLabel(label);

    return settings.blockedChannels.find(item => {
      const itemKey = normalizeKey(item.key || item);
      if (normalizedKey && itemKey === normalizedKey) return true;

      const itemLabel = normalizeLabel(item.label || '');
      return !normalizedKey && normalizedLabel && itemLabel && itemLabel === normalizedLabel;
    }) || null;
  }

  function isBlocked(key, label = '') {
    return !!blockedEntryFor(key, label);
  }

  async function setBlocked(key, blocked, label = '') {
    if (!key) return;
    const normalizedKey = normalizeKey(key);
    const existing = settings.blockedChannels.filter(x => normalizeKey(x.key || x) !== normalizedKey);
    if (blocked) {
      existing.push({
        key: normalizedKey,
        label: label || undefined,
        addedAt: new Date().toISOString()
      });
    }
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

  function videoUrlFromCard(card) {
    const selectors = [
      'a[href*="/watch?"]',
      'a[href^="/shorts/"]',
      'a[href*="youtube.com/watch?"]',
      'a[href*="youtube.com/shorts/"]'
    ];
    for (const selector of selectors) {
      const el = card.querySelector(selector);
      const raw = el?.href || el?.getAttribute?.('href');
      if (raw) return new URL(raw, location.origin).href;
    }
    return '';
  }

  function extractKeyFromWatchHtml(html) {
    if (!html) return '';
    const decoded = html
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/');

    const ownerProfile = decoded.match(/"ownerProfileUrl"\s*:\s*"([^"]+)"/i)?.[1];
    if (ownerProfile) {
      const key = normalizeKey(ownerProfile);
      if (key) return key;
    }

    const canonical = decoded.match(/"canonicalBaseUrl"\s*:\s*"(\/@[^"]+|\/channel\/[^"]+)"/i)?.[1];
    if (canonical) {
      const key = normalizeKey(canonical);
      if (key) return key;
    }

    const channelId = decoded.match(/"channelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"/i)?.[1];
    return channelId ? normalizeKey(`/channel/${channelId}`) : '';
  }

  async function resolveChannelKey(card) {
    const direct = findChannelKey(card);
    if (direct) return direct;

    const videoUrl = videoUrlFromCard(card);
    if (!videoUrl) return '';

    try {
      const response = await fetch(videoUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'force-cache'
      });
      if (!response.ok) return '';
      const html = await response.text();
      const key = extractKeyFromWatchHtml(html);
      if (key) card.dataset.bfyChannelKey = key;
      return key;
    } catch {
      return '';
    }
  }

  function isContentCard(card) {
    if (!card?.querySelector) return false;
    if (/post|backstage/i.test(card.tagName)) return true;
    return !!card.querySelector('a[href*="/watch?"],a[href^="/shorts/"],a[href*="youtube.com/watch?"],a[href*="youtube.com/shorts/"]');
  }

  function addBlockButton(card, knownKey = '') {
    if (!isContentCard(card) || card.querySelector(':scope > .bfy-block-button')) return;
    card.classList.add('bfy-card');

    const btn = document.createElement('button');
    btn.className = 'bfy-block-button';
    btn.type = 'button';
    btn.textContent = '차단';
    btn.title = '이 채널을 Blackout 목록에 추가';
    if (knownKey) btn.dataset.bfyKey = knownKey;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (btn.dataset.bfyBusy === 'true') return;
      btn.dataset.bfyBusy = 'true';
      btn.textContent = '확인 중';
      btn.disabled = true;

      const key = knownKey || await resolveChannelKey(card);
      const label = channelLabelFromCard(card);

      if (!key) {
        btn.textContent = '재시도';
        btn.title = '채널 정보를 찾지 못했습니다. 다시 눌러주세요.';
        btn.disabled = false;
        btn.dataset.bfyBusy = 'false';
        return;
      }

      await setBlocked(key, true, label);
      card.dataset.bfyChannelKey = key;
      if (label) card.dataset.bfyChannelLabel = label;
      btn.remove();
      applyMode(card);
      queueScan();
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
    if (!(card instanceof HTMLElement) || !isContentCard(card)) return;

    const key = findChannelKey(card);
    const label = channelLabelFromCard(card);

    if (settings.enabled && isBlocked(key, label)) {
      card.querySelector(':scope > .bfy-block-button')?.remove();
      applyMode(card);
    } else {
      restore(card);
      addBlockButton(card, key);
    }
  }

  function processChannelLinkFallbacks(root = document) {
    const links = channelLinksIn(root);
    for (const { el } of links) {
      const card = el.closest?.(OUTER_CARD_SELECTOR);
      if (card) processCard(card);
    }
  }

  function processHomeCards(root = document) {
    const selectors = [
      'ytd-browse[page-subtype="home"] ytd-rich-item-renderer',
      'ytd-browse[page-subtype="home"] ytd-rich-grid-media',
      'ytd-browse[page-subtype="home"] yt-lockup-view-model',
      'ytd-rich-grid-renderer ytd-rich-item-renderer',
      'ytd-rich-grid-renderer ytd-rich-grid-media',
      'ytd-rich-grid-renderer yt-lockup-view-model'
    ];

    for (const selector of selectors) {
      root.querySelectorAll?.(selector).forEach(processCard);
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
        const label = getChannelPageLabel();
        await setBlocked(currentKey, !isBlocked(currentKey), label);
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

    processHomeCards(root);
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
  window.addEventListener('yt-page-data-updated', queueScan, true);
  window.addEventListener('popstate', queueScan, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) queueScan();
  });

  loadSettings();
})();
