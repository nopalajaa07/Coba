// ===== State =====
let transactions = [];
let customCategories = [];
let spendingLimit = 0; // stored in baseCurrency (IDR default)
let chart = null;
let currentCurrency = 'IDR';
let exchangeRates = {}; // { USD: 0.000062, EUR: 0.000057, ... } relative to IDR base
let ratesBaseCurrency = 'IDR';

const STORAGE_KEYS = {
  transactions:      'bv_transactions',
  customCategories:  'bv_custom_categories',
  spendingLimit:     'bv_spending_limit',
  theme:             'bv_theme',
  currency:          'bv_currency',
  rates:             'bv_rates',
  ratesTimestamp:    'bv_rates_ts',
  ratesBase:         'bv_rates_base',
};

const RATES_TTL_MS = 60 * 60 * 1000; // cache 1 hour

// ===== Currency Config =====
const CURRENCIES = {
  IDR: { code: 'IDR', locale: 'id-ID', decimals: 0 },
  USD: { code: 'USD', locale: 'en-US', decimals: 2 },
  EUR: { code: 'EUR', locale: 'de-DE', decimals: 2 },
  GBP: { code: 'GBP', locale: 'en-GB', decimals: 2 },
  JPY: { code: 'JPY', locale: 'ja-JP', decimals: 0 },
  SGD: { code: 'SGD', locale: 'en-SG', decimals: 2 },
  MYR: { code: 'MYR', locale: 'ms-MY', decimals: 2 },
  AUD: { code: 'AUD', locale: 'en-AU', decimals: 2 },
  KRW: { code: 'KRW', locale: 'ko-KR', decimals: 0 },
  CNY: { code: 'CNY', locale: 'zh-CN', decimals: 2 },
};

function formatCurrency(amount) {
  const cfg = CURRENCIES[currentCurrency] || CURRENCIES['IDR'];
  return new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: cfg.code,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  }).format(amount);
}

// Convert an amount from fromCurrency to toCurrency using cached rates (all relative to IDR)
function convert(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  if (Object.keys(exchangeRates).length === 0) return amount; // no rates yet, show as-is

  // rates are: 1 IDR = exchangeRates[X] X
  // so: 1 X = 1 / exchangeRates[X] IDR
  const toIDR = fromCurrency === 'IDR' ? amount : amount / exchangeRates[fromCurrency];
  const toTarget = toCurrency === 'IDR' ? toIDR : toIDR * exchangeRates[toCurrency];
  return toTarget;
}

// Convert a transaction's stored amount to the currently displayed currency
function displayAmount(t) {
  return convert(t.baseAmount, t.baseCurrency, currentCurrency);
}

// ===== DOM References =====
const form             = document.getElementById('transaction-form');
const itemNameInput    = document.getElementById('item-name');
const amountInput      = document.getElementById('amount');
const categorySelect   = document.getElementById('category');
const formError        = document.getElementById('form-error');
const totalBalanceEl   = document.getElementById('total-balance');
const transactionList  = document.getElementById('transaction-list');
const sortSelect       = document.getElementById('sort-by');
const themeToggle      = document.getElementById('theme-toggle');
const spendingLimitInput = document.getElementById('spending-limit');
const setLimitBtn      = document.getElementById('set-limit-btn');
const limitWarning     = document.getElementById('limit-warning');
const newCustomCatInput = document.getElementById('new-custom-cat');
const addCatBtn        = document.getElementById('add-cat-btn');
const chartCanvas      = document.getElementById('spending-chart');
const chartEmpty       = document.getElementById('chart-empty');
const currencySelect   = document.getElementById('currency-select');
const rateStatus       = document.getElementById('rate-status');

// ===== Exchange Rates =====
async function fetchRates() {
  // Check cache first
  const cached    = localStorage.getItem(STORAGE_KEYS.rates);
  const cachedTs  = parseInt(localStorage.getItem(STORAGE_KEYS.ratesTimestamp) || '0');
  const cachedBase = localStorage.getItem(STORAGE_KEYS.ratesBase);

  if (cached && cachedBase === 'IDR' && Date.now() - cachedTs < RATES_TTL_MS) {
    exchangeRates = JSON.parse(cached);
    ratesBaseCurrency = 'IDR';
    setRateStatus('✓ Rates loaded', false);
    return;
  }

  setRateStatus('⟳ Fetching rates...', false);

  try {
    // Free API — no key needed, uses open.er-api.com
    const res = await fetch('https://open.er-api.com/v6/latest/IDR');
    if (!res.ok) throw new Error('Network error');
    const data = await res.json();

    if (data.result !== 'success') throw new Error('API error');

    exchangeRates = data.rates; // { USD: x, EUR: x, ... } where 1 IDR = x
    ratesBaseCurrency = 'IDR';

    localStorage.setItem(STORAGE_KEYS.rates, JSON.stringify(exchangeRates));
    localStorage.setItem(STORAGE_KEYS.ratesTimestamp, Date.now().toString());
    localStorage.setItem(STORAGE_KEYS.ratesBase, 'IDR');

    setRateStatus('✓ Live rates', false);
  } catch (err) {
    // Fallback to hardcoded approximate rates (1 IDR = ?)
    exchangeRates = {
      IDR: 1,
      USD: 0.000062,
      EUR: 0.000057,
      GBP: 0.000049,
      JPY: 0.0094,
      SGD: 0.000084,
      MYR: 0.000293,
      AUD: 0.000096,
      KRW: 0.084,
      CNY: 0.00045,
    };
    ratesBaseCurrency = 'IDR';
    setRateStatus('⚠ Offline rates', true);
  }

  renderAll();
}

function setRateStatus(msg, isWarn) {
  if (!rateStatus) return;
  rateStatus.textContent = msg;
  rateStatus.className = 'rate-status' + (isWarn ? ' rate-warn' : '');
}

// ===== Local Storage =====
function saveData() {
  localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  localStorage.setItem(STORAGE_KEYS.customCategories, JSON.stringify(customCategories));
  localStorage.setItem(STORAGE_KEYS.spendingLimit, spendingLimit);
  localStorage.setItem(STORAGE_KEYS.currency, currentCurrency);
}

function loadData() {
  transactions     = JSON.parse(localStorage.getItem(STORAGE_KEYS.transactions) || '[]');
  customCategories = JSON.parse(localStorage.getItem(STORAGE_KEYS.customCategories) || '[]');
  spendingLimit    = parseFloat(localStorage.getItem(STORAGE_KEYS.spendingLimit) || '0');
  currentCurrency  = localStorage.getItem(STORAGE_KEYS.currency) || 'IDR';

  // Migrate old transactions that don't have baseCurrency
  transactions = transactions.map(t => ({
    ...t,
    baseCurrency: t.baseCurrency || 'IDR',
    baseAmount:   t.baseAmount   !== undefined ? t.baseAmount : t.amount,
  }));

  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

  currencySelect.value = currentCurrency;
  if (spendingLimit > 0) spendingLimitInput.value = spendingLimit;
  renderCustomCategoryOptions();
}

// ===== Currency Selector =====
currencySelect.addEventListener('change', async () => {
  currentCurrency = currencySelect.value;
  saveData();
  // Update spending limit display to reflect new currency
  if (spendingLimit > 0) {
    const converted = convert(spendingLimit, 'IDR', currentCurrency);
    const cfg = CURRENCIES[currentCurrency];
    spendingLimitInput.placeholder = `e.g. ${Math.round(converted).toLocaleString()}`;
  }
  renderAll();
});

// ===== Theme =====
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(STORAGE_KEYS.theme, next);
  updateChart();
});

// ===== Spending Limit =====
// Limit is stored in IDR internally
setLimitBtn.addEventListener('click', () => {
  const val = parseFloat(spendingLimitInput.value);
  if (isNaN(val) || val < 0) { spendingLimit = 0; }
  else {
    // Convert entered value (in currentCurrency) back to IDR for storage
    spendingLimit = convert(val, currentCurrency, 'IDR');
  }
  saveData();
  renderAll();
});

function checkSpendingLimit() {
  const totalIDR = transactions.reduce((sum, t) => sum + convert(t.baseAmount, t.baseCurrency, 'IDR'), 0);
  if (spendingLimit > 0 && totalIDR > spendingLimit) {
    limitWarning.classList.remove('hidden');
  } else {
    limitWarning.classList.add('hidden');
  }
}

function getTotalDisplayed() {
  return transactions.reduce((sum, t) => sum + displayAmount(t), 0);
}

// ===== Custom Categories =====
addCatBtn.addEventListener('click', () => {
  const name = newCustomCatInput.value.trim();
  if (!name) return;
  if (!customCategories.includes(name)) {
    customCategories.push(name);
    saveData();
    renderCustomCategoryOptions();
  }
  newCustomCatInput.value = '';
});

function renderCustomCategoryOptions() {
  const existingCustom = categorySelect.querySelectorAll('.dynamic-custom');
  existingCustom.forEach(o => o.remove());
  customCategories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    opt.className = 'dynamic-custom';
    categorySelect.appendChild(opt);
  });
}

// ===== Form Submission =====
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const name     = itemNameInput.value.trim();
  const amount   = parseFloat(amountInput.value);
  const category = categorySelect.value;

  if (!name || isNaN(amount) || amount <= 0 || !category) {
    formError.classList.remove('hidden');
    return;
  }

  formError.classList.add('hidden');

  transactions.push({
    id:           Date.now(),
    name,
    baseAmount:   amount,
    baseCurrency: currentCurrency, // store in whatever currency user typed
    amount:       amount,          // kept for backward compat
    category,
    date: new Date().toLocaleDateString(),
  });

  saveData();
  renderAll();

  itemNameInput.value  = '';
  amountInput.value    = '';
  categorySelect.value = '';
});

// ===== Delete =====
function deleteTransaction(id) {
  transactions = transactions.filter(t => t.id !== id);
  saveData();
  renderAll();
}

// ===== Sort =====
function getSortedTransactions() {
  const sorted = [...transactions];
  const sortBy = sortSelect.value;
  if (sortBy === 'amount-asc')  sorted.sort((a, b) => displayAmount(a) - displayAmount(b));
  else if (sortBy === 'amount-desc') sorted.sort((a, b) => displayAmount(b) - displayAmount(a));
  else if (sortBy === 'category') sorted.sort((a, b) => a.category.localeCompare(b.category));
  return sorted;
}

sortSelect.addEventListener('change', renderTransactionList);

// ===== Render =====
function renderAll() {
  renderBalance();
  renderTransactionList();
  updateChart();
  checkSpendingLimit();
}

function renderBalance() {
  totalBalanceEl.textContent = formatCurrency(getTotalDisplayed());
}

function renderTransactionList() {
  const sorted = getSortedTransactions();
  transactionList.innerHTML = '';

  if (sorted.length === 0) {
    transactionList.innerHTML = '<li class="empty-state">No transactions yet.</li>';
    return;
  }

  // Spending limit in currentCurrency for per-item highlight
  const limitInCurrent = spendingLimit > 0 ? convert(spendingLimit, 'IDR', currentCurrency) : 0;

  sorted.forEach(t => {
    const li = document.createElement('li');
    li.className = 'transaction-item';

    const converted = displayAmount(t);
    if (limitInCurrent > 0 && converted > limitInCurrent) {
      li.classList.add('over-limit');
    }

    const badgeClass = ['Food', 'Transport', 'Fun'].includes(t.category)
      ? `badge-${t.category}` : 'badge-Custom';

    // Show original amount if different from current currency
    const originalNote = t.baseCurrency !== currentCurrency
      ? `<span class="original-amount">(${formatAmountIn(t.baseAmount, t.baseCurrency)})</span>`
      : '';

    li.innerHTML = `
      <div class="transaction-info">
        <div class="transaction-name">${escapeHtml(t.name)}</div>
        <div class="transaction-meta">
          <span class="category-badge ${badgeClass}">${escapeHtml(t.category)}</span>
          &nbsp;${t.date}
        </div>
      </div>
      <div class="amount-col">
        <span class="transaction-amount">-${formatCurrency(converted)}</span>
        ${originalNote}
      </div>
      <button class="delete-btn" aria-label="Delete transaction" data-id="${t.id}">🗑️</button>
    `;

    li.querySelector('.delete-btn').addEventListener('click', () => deleteTransaction(t.id));
    transactionList.appendChild(li);
  });
}

function formatAmountIn(amount, currency) {
  const cfg = CURRENCIES[currency] || CURRENCIES['IDR'];
  return new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: cfg.code,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  }).format(amount);
}

// ===== Chart =====
const CATEGORY_COLORS = {
  Food:      '#f59e0b',
  Transport: '#3b82f6',
  Fun:       '#ec4899',
};

function getCategoryColor(cat, index) {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  const palette = ['#10b981', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#e11d48'];
  return palette[index % palette.length];
}

function updateChart() {
  const totals = {};
  transactions.forEach(t => {
    const val = displayAmount(t);
    totals[t.category] = (totals[t.category] || 0) + val;
  });

  const labels = Object.keys(totals);
  const data   = Object.values(totals);

  if (labels.length === 0) {
    chartEmpty.classList.remove('hidden');
    chartCanvas.classList.add('hidden');
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  chartEmpty.classList.add('hidden');
  chartCanvas.classList.remove('hidden');

  const colors  = labels.map((label, i) => getCategoryColor(label, i));
  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#f1f1f5' : '#1a1a2e';

  if (chart) chart.destroy();

  chart = new Chart(chartCanvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: isDark ? '#1a1a2e' : '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor, font: { size: 12 }, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

// ===== Utility =====
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== Init =====
loadData();
renderAll();
fetchRates(); // async — re-renders when done
