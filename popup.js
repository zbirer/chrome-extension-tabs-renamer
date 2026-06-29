// ── State ──────────────────────────────────────────────────────────────────
const CONFIG_KEY = 'rules';

let rules = [];
let editingIndex = -1; // -1 = new rule
let currentTab = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const rulesList      = document.getElementById('rules-list');
const emptyState     = document.getElementById('empty-state');
const ruleForm       = document.getElementById('rule-form');
const formTitle      = document.getElementById('form-title');
const inputBaseUrl   = document.getElementById('input-base-url');
const inputTemplate  = document.getElementById('input-template');
const formPreview    = document.getElementById('form-preview');
const btnAdd         = document.getElementById('btn-add');
const btnSave        = document.getElementById('btn-save');
const btnCancel      = document.getElementById('btn-cancel');
const btnApplyNow    = document.getElementById('btn-apply-now');
const currentHostname = document.getElementById('current-hostname');
const currentTitle   = document.getElementById('current-title');

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  rules = await getStoredRules();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab?.url) {
    try {
      const u = new URL(tab.url);
      currentHostname.textContent = u.hostname.replace(/^www\./, '');
    } catch { currentHostname.textContent = ''; }
    currentTitle.textContent = tab.title || '';
  }

  render();
}

// ── Render rules list ──────────────────────────────────────────────────────
function render() {
  rulesList.innerHTML = '';
  emptyState.classList.toggle('hidden', rules.length > 0);

  rules.forEach((rule, i) => {
    const li = document.createElement('li');
    li.className = 'rule-item' + (rule.enabled === false ? ' disabled' : '');
    const baseUrl = rule.baseUrl || rule.pattern || '';

    li.innerHTML = `
      <span class="rule-base-url">${escHtml(baseUrl)}</span>
      <span class="rule-template">${escHtml(rule.template)}</span>
      <div class="rule-actions">
        <button class="btn-toggle" title="${rule.enabled === false ? 'Enable' : 'Disable'}">${rule.enabled === false ? '○' : '●'}</button>
        <button class="btn-edit" title="Edit">✎</button>
        <button class="btn-delete" title="Delete">✕</button>
      </div>
    `;

    li.querySelector('.btn-toggle').addEventListener('click', () => toggleRule(i));
    li.querySelector('.btn-edit').addEventListener('click', () => openForm(i));
    li.querySelector('.btn-delete').addEventListener('click', () => deleteRule(i));

    rulesList.appendChild(li);
  });
}

// ── Form ───────────────────────────────────────────────────────────────────
function openForm(index = -1) {
  editingIndex = index;
  ruleForm.classList.remove('hidden');
  formTitle.textContent = index === -1 ? 'Add rule' : 'Edit rule';

  if (index === -1) {
    // Pre-fill with the current tab's base URL (hostname)
    inputBaseUrl.value = currentTab?.url ? (() => {
      try {
        const u = new URL(currentTab.url);
        // Strip leading "www." so "www.github.com" becomes "github.com"
        return u.hostname.replace(/^www\./, '');
      } catch { return ''; }
    })() : '';
    inputTemplate.value = '{title}';
  } else {
    inputBaseUrl.value = rules[index].baseUrl || rules[index].pattern || '';
    inputTemplate.value = rules[index].template;
  }

  updatePreview();
  inputBaseUrl.focus();
}

function closeForm() {
  ruleForm.classList.add('hidden');
  formPreview.classList.add('hidden');
  editingIndex = -1;
}

function updatePreview() {
  const template = inputTemplate.value.trim();
  if (!template) { formPreview.classList.add('hidden'); return; }

  const title = currentTab?.title || 'Page title';
  const url = currentTab?.url || 'https://example.com/page';

  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '');
    const preview = template
      .replace(/\{title\}/g, title)
      .replace(/\{hostname\}/g, u.hostname)
      .replace(/\{domain\}/g, domain)
      .replace(/\{path\}/g, u.pathname);
    formPreview.textContent = preview;
    formPreview.classList.remove('hidden');
  } catch {
    formPreview.classList.add('hidden');
  }
}

async function saveRule() {
  const baseUrl = inputBaseUrl.value.trim();
  const template = inputTemplate.value.trim();
  if (!baseUrl || !template) return;

  const rule = { baseUrl, template, enabled: true };

  if (editingIndex === -1) {
    rules.unshift(rule);
  } else {
    rules[editingIndex] = { ...rules[editingIndex], ...rule };
  }

  await persist();
  closeForm();
  render();
}

// ── Rule actions ───────────────────────────────────────────────────────────
async function deleteRule(index) {
  rules.splice(index, 1);
  await persist();
  render();
}

async function toggleRule(index) {
  rules[index].enabled = rules[index].enabled === false ? true : false;
  await persist();
  render();
}

async function persist() {
  await chrome.storage.local.set({ [CONFIG_KEY]: rules });
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

// ── Apply now ──────────────────────────────────────────────────────────────
function applyNow() {
  chrome.runtime.sendMessage({ type: 'APPLY_NOW' }, () => {
    btnApplyNow.textContent = 'Applied ✓';
    setTimeout(() => { btnApplyNow.textContent = 'Apply now'; }, 1500);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Event listeners ────────────────────────────────────────────────────────
btnAdd.addEventListener('click', () => openForm());
btnSave.addEventListener('click', saveRule);
btnCancel.addEventListener('click', closeForm);
btnApplyNow.addEventListener('click', applyNow);
inputBaseUrl.addEventListener('input', updatePreview);
inputTemplate.addEventListener('input', updatePreview);

inputBaseUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') inputTemplate.focus(); });
inputTemplate.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRule(); });

init();
