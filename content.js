(() => {
  const DEFAULTS = { enabled: true, mode: 'blackout', blockedChannels: [], customImage: '' };
  let settings = { ...DEFAULTS };
  let scanQueued = false;

  const CARD_SELECTOR = [
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

  const CHANNEL_PREFIXES = ['channel', 'c', 'user'];

  function normalizeKey(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (!parts.length) return '';
      if (parts[0].startsWith('@')) return `/${parts[0]}`.toLowerCase();
      if (CHANNEL_PREFIXES.includes(parts[0]) && parts[1]) {
        return `/${parts[0]}/${parts[1]}`.toLowerCase();
      }
      return '';
    } catch {
      return String(value).trim().toLowerCase();
    }
  }

  function normalizeLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }

  function getChannelPageKey() {
    return /^\/(?:@|channel\/|c\/|user\/)/i.test(location.pathname)
      ? normalizeKey(location.href)
      : '';
  }

  function getChannelPageLabel() {
    const selectors = [
      'yt-page-header-renderer h1',
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

  function channelLinksIn(root) {
    if (!root?.querySelectorAll) return [];
    return [...root.querySelectorAll('[href]')]
      .map(el => ({ el, key: normalizeKey(el.href || el.getAttribute('href')) }))
      .filter(x => x.key);
  }

  function findExplicitChannelKey(card) {
    if (!card?.querySelectorAll) return '';
    const cached = normalizeKey(card.dataset?.bfyChannelKey || '');
    if (cached) return cached;

    const links = channelLinksIn(card);
    if (!links.length) return '';

    const preferred = links.find(({ el }) => {
      const hint = [
        el.id,
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute?.('aria-label'),
        el.closest?.('ytd-channel-name')?.id,
        el.closest?.('[id*="channel"]')?.id,
        el.closest?.('[class*="channel"]')?.className,
        el.closest?.('[id*="author"]')?.id,
        el.closest?.('[class*="author"]')?.className,
        el.closest?.('[id*="byline"]')?.id,
        el.closest?.('[class*="byline"]')?.className
      ].filter(Boolean).join(' ');
      return /channel|author|byline|owner|avatar/i.test(hint);
    });

    const key = (preferred || links[0])?.key || '';
    if (key) card.dataset.bfyChannelKey = key;
    return key;
  }

  function channelLabelFromCard(card) {
    if (!card?.querySelector) return '';
    const cached = card.dataset?.bfyChannelLabel;
    if (cached) return cached;

    const selectors = [
      'ytd-channel-name #text',
      '#channel-name #text',
      '#channel-name a',
      '#byline-container a',
      '#byline a',
      '.yt-content-metadata-view-model__metadata-row:first-child a',
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

  function blockedEntryFor(key, label = '') {
    const k = normalizeKey(key);
    const l = normalizeLabel(label);
    return settings.blockedChannels.find(item => {
      const itemKey = normalizeKey(item.key || item);
      if (k && itemKey === k) return true;
      const itemLabel = normalizeLabel(item.label || '');
      return !k && l && itemLabel && itemLabel === l;
    }) || null;
  }

  function isBlocked(key, label = '') {
    return !!blockedEntryFor(key, label);
  }

  async function setBlocked(key, blocked, label = '') {
    const k = normalizeKey(key);
    if (!k) return;
    const next = settings.blockedChannels.filter(item => normalizeKey(item.key || item) !== k);
    if (blocked) next.push({ key: k, label: label || undefined, addedAt: new Date().toISOString() });
    settings.blockedChannels = next;
    await chrome.storage.local.set({ blockedChannels: next });
  }

  function isContentCard(card) {
    if (!card?.querySelector) return false;
    if (/post|backstage/i.test(card.tagName)) return true;
    return !!card.querySelector(
      'a[href*="/watch?"], a[href^="/shorts/"], a[href*="youtube.com/watch?"], a[href*="youtube.com/shorts/"]'
    );
  }

  function labelFor(card) {
    const tag = card.tagName.toLowerCase();
    if (/post|backstage/.test(tag)) return '차단된 채널의 게시물';
    if (/reel|shorts/.test(tag)) return '차단된 채널의 Shorts';
    return '차단된 채널의 콘텐츠';
  }

  function restore(card) {
    card.classList.remove('bfy-hidden', 'bfy-censored', 'bfy-blur', 'bfy-image');
    card.style.removeProperty('--bfy-custom-image');
    delete card.dataset.bfyLabel;
  }

  function applyMode(card) {
    restore(card);
    if (settings.mode === 'hide') {
      card.classList.add('bfy-hidden');
      return;
    }
    card.classList.add('bfy-censored');
    card.dataset.bfyLabel = labelFor(card);
    if (settings.mode === 'blur') card.classList.add('bfy-blur');
    if (settings.mode === 'image' && settings.customImage) {
      card.classList.add('bfy-image');
      const safe = settings.customImage.replace(/"/g, '%22');
      card.style.setProperty('--bfy-custom-image', `url("${safe}")`);
    }
  }

  function videoUrlFromCard(card) {
    const el = card.querySelector(
      'a[href*="/watch?"], a[href^="/shorts/"], a[href*="youtube.com/watch?"], a[href*="youtube.com/shorts/"]'
    );
    const raw = el?.href || el?.getAttribute?.('href');
    return raw ? new URL(raw, location.origin).href : '';
  }

  function extractChannelFromWatchHtml(html) {
    if (!html) return '';
    const decoded = html.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    const owner = decoded.match(/"ownerProfileUrl"\s*:\s*"([^"]+)"/i)?.[1];
    if (owner) {
      const key = normalizeKey(owner);
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
    const direct = findExplicitChannelKey(card);
    if (direct) return direct;

    const pageKey = getChannelPageKey();
    if (pageKey) return pageKey;

    const url = videoUrlFromCard(card);
    if (!url) return '';
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
      if (!response.ok) return '';
      const key = extractChannelFromWatchHtml(await response.text());
      if (key) card.dataset.bfyChannelKey = key;
      return key;
    } catch {
      return '';
    }
  }

  function makeCardButton(card, knownKey = '') {
    if (getChannelPageKey()) return;
    if (!isContentCard(card) || card.querySelector(':scope > .bfy-block-button')) return;

    card.classList.add('bfy-card');
    const btn = document.createElement('button');
    btn.className = 'bfy-block-button';
    btn.type = 'button';
    btn.textContent = '차단';
    btn.title = '이 채널을 Blackout 목록에 추가';

    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      btn.disabled = true;
      btn.textContent = '확인 중';

      const key = knownKey || await resolveChannelKey(card);
      const label = channelLabelFromCard(card);
      if (!key) {
        btn.dataset.busy = '0';
        btn.disabled = false;
        btn.textContent = '재시도';
        btn.title = '채널 정보를 찾지 못했습니다.';
        return;
      }

      await setBlocked(key, true, label);
      card.dataset.bfyChannelKey = key;
      btn.remove();
      applyMode(card);
      queueScan();
    }, true);

    card.appendChild(btn);
  }

  function processCard(card) {
    if (!(card instanceof HTMLElement) || !isContentCard(card)) return;

    const pageKey = getChannelPageKey();
    const explicitKey = findExplicitChannelKey(card);
    const label = channelLabelFromCard(card);

    if (pageKey) {
      card.querySelector(':scope > .bfy-block-button')?.remove();
      const key = explicitKey || pageKey;
      const pageBlocked = isBlocked(pageKey, getChannelPageLabel());
      const cardBlocked = isBlocked(key, label);

      if (settings.enabled && (cardBlocked || (!explicitKey && pageBlocked))) applyMode(card);
      else restore(card);
      return;
    }

    if (settings.enabled && isBlocked(explicitKey, label)) {
      card.querySelector(':scope > .bfy-block-button')?.remove();
      applyMode(card);
    } else {
      restore(card);
      makeCardButton(card, explicitKey);
    }
  }

  function findChannelHeaderTarget() {
    const selectors = [
      'yt-page-header-renderer #actions',
      'yt-page-header-renderer #buttons',
      'yt-page-header-renderer yt-flexible-actions-view-model',
      'ytd-c4-tabbed-header-renderer #buttons',
      '#channel-header-container #buttons',
      'yt-page-header-renderer'
    ];
    return selectors.map(s => document.querySelector(s)).find(Boolean) || null;
  }

  function updateChannelPageButton() {
    const pageKey = getChannelPageKey();
    let btn = document.querySelector('.bfy-channel-block-button');

    if (!pageKey) {
      btn?.remove();
      return;
    }

    const target = findChannelHeaderTarget();
    if (!target) return;

    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'bfy-channel-block-button';
      btn.type = 'button';
      btn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        const key = getChannelPageKey();
        if (!key) return;
        const label = getChannelPageLabel();
        await setBlocked(key, !isBlocked(key, label), label);
        queueScan();
      }, true);
    }

    if (btn.parentElement !== target) target.appendChild(btn);
    const blocked = isBlocked(pageKey, getChannelPageLabel());
    btn.dataset.blocked = blocked ? 'true' : 'false';
    btn.textContent = blocked ? '차단 해제' : '채널 차단';
    btn.title = blocked ? 'Blackout 목록에서 이 채널 제거' : 'Blackout 목록에 이 채널 추가';
  }

  function clearStaleCardButtonsOnChannelPage() {
    if (!getChannelPageKey()) return;
    document.querySelectorAll('.bfy-block-button').forEach(btn => btn.remove());
  }

  function scan(root = document) {
    if (!settings.enabled) document.querySelectorAll('.bfy-censored,.bfy-hidden').forEach(restore);

    root.querySelectorAll?.(CARD_SELECTOR).forEach(processCard);
    if (root.matches?.(CARD_SELECTOR)) processCard(root);

    clearStaleCardButtonsOnChannelPage();
    updateChannelPageButton();
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }

  async function load() {
    settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    scan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    queueScan();
  });

  new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', queueScan, true);
  window.addEventListener('popstate', queueScan, true);
  load();
})();
