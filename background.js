// Applies stored renaming rules to a tab
const CONFIG_KEY = 'rules';

async function applyRules(tabId, tab) {
  if (!tab?.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) return;

  const rules = await getStoredRules();
  const activeRules = rules.filter(r => r.enabled !== false);
  let matchedRule = false;

  for (const rule of activeRules) {
    if (matchesBaseUrl(tab.url, rule.baseUrl || rule.pattern)) {
      matchedRule = true;
      const newTitle = buildTitle(rule.template, tab.title || '', tab.url);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: keepTabTitle,
          args: [newTitle],
        });
      } catch {
        // Tab may be in a state that doesn't allow scripting (e.g. PDF viewer)
      }
      break;
    }
  }

  if (!matchedRule) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: stopKeepingTabTitle,
      });
    } catch {
      // Tab may be in a state that doesn't allow scripting (e.g. PDF viewer)
    }
  }
}

function keepTabTitle(title) {
  const stateKey = '__tabRenamerState';

  if (window[stateKey]?.observer) {
    window[stateKey].observer.disconnect();
  }

  const applyTitle = () => {
    if (document.title !== title) {
      document.title = title;
    }
  };

  applyTitle();

  const titleElement = document.querySelector('title') || document.head?.appendChild(document.createElement('title'));
  const observer = new MutationObserver(applyTitle);

  if (titleElement) {
    observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
  }

  window[stateKey] = { observer, title };

  setTimeout(applyTitle, 250);
  setTimeout(applyTitle, 1000);
  setTimeout(applyTitle, 3000);
}

function stopKeepingTabTitle() {
  const stateKey = '__tabRenamerState';
  if (window[stateKey]?.observer) {
    window[stateKey].observer.disconnect();
  }
  delete window[stateKey];
}

async function getStoredRules() {
  const localConfig = await chrome.storage.local.get(CONFIG_KEY);
  if (Array.isArray(localConfig[CONFIG_KEY])) return localConfig[CONFIG_KEY];

  const syncConfig = await chrome.storage.sync.get(CONFIG_KEY);
  const syncedRules = syncConfig[CONFIG_KEY];
  if (Array.isArray(syncedRules)) {
    await chrome.storage.local.set({ [CONFIG_KEY]: syncedRules });
    return syncedRules;
  }

  return [];
}

// Matches by base URL. Hostname-only rules can be:
//   "github.com"          → matches github.com and any subdomain (sub.github.com)
//   "mail.google.com"     → matches only mail.google.com (and its subs)
//   "*.github.com"        → matches subdomains only, NOT github.com itself
// Full URL rules like "https://github.com/org" match tabs whose URL starts with it.
function matchesBaseUrl(url, baseUrl) {
  if (!baseUrl?.trim()) return false;

  try {
    const tabUrl = new URL(url);
    const tabHostname = tabUrl.hostname.toLowerCase();
    let base = baseUrl.trim().toLowerCase();

    // Wildcard subdomain: *.example.com → subdomains only
    if (base.startsWith('*.')) {
      const suffix = base.slice(2);
      return tabHostname.endsWith('.' + suffix);
    }

    if (/^https?:\/\//.test(base)) {
      const ruleUrl = new URL(base);
      const rulePath = normalizePath(ruleUrl.pathname);

      return tabUrl.protocol === ruleUrl.protocol &&
        tabUrl.hostname.toLowerCase() === ruleUrl.hostname.toLowerCase() &&
        (rulePath === '/' || tabUrl.pathname === rulePath || tabUrl.pathname.startsWith(rulePath + '/'));
    }

    const hostname = base.replace(/\/.*$/, '');
    return tabHostname === hostname || tabHostname.endsWith('.' + hostname);
  } catch {
    return false;
  }
}

function normalizePath(pathname) {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

// Template variables: {title}, {hostname}, {domain}, {path}
function buildTitle(template, originalTitle, url) {
  const cleanTitle = unwrapExistingTitle(template, originalTitle);

  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '');
    return template
      .replace(/\{title\}/g, cleanTitle)
      .replace(/\{hostname\}/g, u.hostname)
      .replace(/\{domain\}/g, domain)
      .replace(/\{path\}/g, u.pathname);
  } catch {
    return template.replace(/\{title\}/g, cleanTitle);
  }
}

function unwrapExistingTitle(template, title) {
  if (!template.includes('{title}')) return title;

  const titlePattern = template.split('{title}').map(escapeRegExp).join('(.+?)');
  const wrappedTitleRegex = new RegExp('^' + titlePattern + '$');
  let cleanTitle = title;

  while (true) {
    const match = cleanTitle.match(wrappedTitleRegex);
    if (!match?.[1] || match[1] === cleanTitle) return cleanTitle;
    cleanTitle = match[1];
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) {
    applyRules(tabId, tab);
  }
});

// Re-apply when a tab is activated in case the title reset (e.g. SPA navigation)
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    applyRules(tabId, tab);
  } catch {
    // Tab may have been closed already
  }
});

// Message from popup: rename current tab on-demand
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'APPLY_NOW') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) applyRules(tab.id, tab).then(() => sendResponse({ ok: true }));
    });
    return true; // async response
  }
});
