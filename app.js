'use strict';

const DB_NAME = 'bet-tracker-db';
const DB_VERSION = 1;
const STORE_NAME = 'bets';

const state = {
  db: null,
  bets: [],
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  selectedDate: dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
  activeTab: 'tracker',
};

const $ = (id) => document.getElementById(id);

function dateKey(year, monthZeroBased, day) {
  return `${year}-${String(monthZeroBased + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month: month - 1, day };
}

function money(value) {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  return `฿${rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function signedMoney(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(value)}`;
}

function resultLabel(result) {
  return ({
    pending: 'PENDING',
    win: 'WIN',
    win_half: 'WIN HALF',
    loss: 'LOSS',
    loss_half: 'LOSS HALF',
    push: 'PUSH',
  })[result] || String(result).toUpperCase();
}

function profitForBet(bet) {
  if (bet.result === 'win') return bet.stake * (bet.odds - 1);
  if (bet.result === 'win_half') return (bet.stake * (bet.odds - 1)) / 2;
  if (bet.result === 'loss') return -bet.stake;
  if (bet.result === 'loss_half') return -bet.stake / 2;
  return 0;
}

function isWinResult(result) {
  return result === 'win' || result === 'win_half';
}

function isLossResult(result) {
  return result === 'loss' || result === 'loss_half';
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function statsForDate(key) {
  const list = state.bets.filter((bet) => bet.date === key);
  const stake = list.reduce((sum, bet) => sum + bet.stake, 0);
  const pl = list.reduce((sum, bet) => sum + profitForBet(bet), 0);
  const roi = stake > 0 ? (pl / stake) * 100 : 0;
  return { list, stake, pl, roi };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbRequest(mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let request;
    let result;

    try {
      request = callback(store);
    } catch (error) {
      reject(error);
      return;
    }

    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'));
  });
}

async function refreshBets() {
  state.bets = await dbRequest('readonly', (store) => store.getAll());
  state.bets.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

async function addBet(bet) {
  await dbRequest('readwrite', (store) => store.add(bet));
  await refreshBets();
}

async function updateBetResult(id, result) {
  const bet = await dbRequest('readonly', (store) => store.get(id));
  if (!bet) return;
  bet.result = result;
  bet.updatedAt = new Date().toISOString();
  await dbRequest('readwrite', (store) => store.put(bet));
  await refreshBets();
}

async function deleteBet(id) {
  await dbRequest('readwrite', (store) => store.delete(id));
  await refreshBets();
}

function setTone(element, value) {
  element.classList.remove('positive', 'negative');
  if (value > 0) element.classList.add('positive');
  if (value < 0) element.classList.add('negative');
}

function renderMonthSummary() {
  const monthPrefix = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2, '0')}-`;
  const list = state.bets.filter((bet) => bet.date.startsWith(monthPrefix));
  const stake = list.reduce((sum, bet) => sum + bet.stake, 0);
  const pl = list.reduce((sum, bet) => sum + profitForBet(bet), 0);
  const roi = stake > 0 ? (pl / stake) * 100 : 0;

  $('monthStake').textContent = money(stake);
  $('monthPL').textContent = signedMoney(pl);
  $('monthROI').textContent = `${roi > 0 ? '+' : ''}${roi.toFixed(1)}%`;
  $('monthBets').textContent = String(list.length);
  setTone($('monthPL'), pl);
  setTone($('monthROI'), roi);
}

function renderCalendar() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('monthTitle').textContent = `${monthNames[state.viewMonth]} ${state.viewYear}`;

  const grid = $('calendarGrid');
  grid.replaceChildren();

  const firstDay = new Date(state.viewYear, state.viewMonth, 1).getDay();
  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i += 1) {
    const blank = document.createElement('div');
    blank.className = 'calendar-blank';
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(state.viewYear, state.viewMonth, day);
    const stats = statsForDate(key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';
    button.dataset.date = key;
    button.setAttribute('aria-label', `${key}, ${stats.list.length} bets, P/L ${signedMoney(stats.pl)}`);

    if (stats.pl > 0) button.classList.add('win-day');
    if (stats.pl < 0) button.classList.add('loss-day');
    if (key === state.selectedDate) button.classList.add('selected');

    const tone = stats.pl > 0 ? 'positive' : stats.pl < 0 ? 'negative' : '';
    button.innerHTML = `
      <span class="day-top">
        <span class="day-number">${day}</span>
        ${stats.list.length ? `<span class="day-count">${stats.list.length}</span>` : ''}
      </span>
      ${stats.list.length ? `
        <span class="day-money">
          <span class="day-stake">Stake ${money(stats.stake)}</span>
          <span class="day-pl ${tone}">${signedMoney(stats.pl)}</span>
        </span>` : '<span class="day-empty">—</span>'}
    `;
    grid.appendChild(button);
  }

  renderMonthSummary();
}

function renderSelectedDayHeader() {
  const stats = statsForDate(state.selectedDate);
  const { year, month, day } = parseDateKey(state.selectedDate);
  const date = new Date(year, month, day);

  $('selectedDateTitle').textContent = date.toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  $('selectedDaySummary').textContent = stats.list.length
    ? `${stats.list.length} bets · Stake ${money(stats.stake)} · P/L ${signedMoney(stats.pl)} · ROI ${stats.roi > 0 ? '+' : ''}${stats.roi.toFixed(1)}%`
    : 'No bets yet';
}

function createBetCard(bet, { showDate = false } = {}) {
  const pl = profitForBet(bet);
  const card = document.createElement('article');
  card.className = 'bet-card';
  if (isWinResult(bet.result)) card.classList.add('win');
  if (isLossResult(bet.result)) card.classList.add('loss');

  const tone = pl > 0 ? 'positive' : pl < 0 ? 'negative' : '';
  const statusTone = isWinResult(bet.result) ? 'positive' : isLossResult(bet.result) ? 'negative' : '';
  const dateLine = showDate ? `<div class="bet-date">${escapeHTML(formatHistoryDate(bet.date))}</div>` : '';

  card.innerHTML = `
    ${dateLine}
    <div class="bet-card-main">
      <div class="bet-card-copy">
        <strong>${escapeHTML(bet.match)}</strong>
        <div class="bet-meta">${escapeHTML(bet.market)} · @${bet.odds.toFixed(2)} · ${money(bet.stake)}</div>
      </div>
      <div class="bet-result ${tone}">
        <span class="bet-status ${statusTone}">${resultLabel(bet.result)}</span>
        <span>${bet.result === 'pending' ? '—' : signedMoney(pl)}</span>
      </div>
    </div>
    <div class="bet-actions">
      <button type="button" data-action="win" data-id="${bet.id}" class="positive">Win</button>
      <button type="button" data-action="win_half" data-id="${bet.id}" class="positive">Win ½</button>
      <button type="button" data-action="loss" data-id="${bet.id}" class="negative">Loss</button>
      <button type="button" data-action="loss_half" data-id="${bet.id}" class="negative">Loss ½</button>
      <button type="button" data-action="push" data-id="${bet.id}">Push</button>
      <button type="button" data-action="delete" data-id="${bet.id}">Delete</button>
    </div>
  `;
  return card;
}

function renderRecentBets() {
  const list = $('dayBets');
  list.replaceChildren();

  const recent = [...state.bets]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5);

  if (!recent.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No bets yet';
    list.appendChild(empty);
    return;
  }

  recent.forEach((bet) => list.appendChild(createBetCard(bet, { showDate: true })));
}

function formatHistoryDate(key) {
  const { year, month, day } = parseDateKey(key);
  return new Date(year, month, day).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function renderHistory() {
  const wrap = $('historyList');
  wrap.replaceChildren();
  $('historySummary').textContent = `${state.bets.length} total bet${state.bets.length === 1 ? '' : 's'}`;

  if (!state.bets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No history yet';
    wrap.appendChild(empty);
    return;
  }

  const groups = new Map();
  [...state.bets]
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    })
    .forEach((bet) => {
      if (!groups.has(bet.date)) groups.set(bet.date, []);
      groups.get(bet.date).push(bet);
    });

  for (const [date, bets] of groups) {
    const dailyStake = bets.reduce((sum, bet) => sum + bet.stake, 0);
    const dailyPL = bets.reduce((sum, bet) => sum + profitForBet(bet), 0);
    const dailyROI = dailyStake > 0 ? (dailyPL / dailyStake) * 100 : 0;

    const group = document.createElement('section');
    group.className = 'history-group';
    group.innerHTML = `
      <div class="history-date-row">
        <div>
          <strong>${escapeHTML(formatHistoryDate(date))}</strong>
          <span>${bets.length} bet${bets.length === 1 ? '' : 's'}</span>
        </div>
        <div class="history-day-numbers ${dailyPL > 0 ? 'positive' : dailyPL < 0 ? 'negative' : ''}">
          <strong>${signedMoney(dailyPL)}</strong>
          <span>ROI ${dailyROI > 0 ? '+' : ''}${dailyROI.toFixed(1)}%</span>
        </div>
      </div>
      <div class="history-group-list"></div>
    `;
    const groupList = group.querySelector('.history-group-list');
    bets.forEach((bet) => groupList.appendChild(createBetCard(bet)));
    wrap.appendChild(group);
  }
}

function renderAll() {
  renderCalendar();
  renderSelectedDayHeader();
  renderRecentBets();
  renderHistory();
}

function setActiveTab(tab) {
  state.activeTab = tab === 'history' ? 'history' : 'tracker';
  const trackerActive = state.activeTab === 'tracker';
  $('trackerView').hidden = !trackerActive;
  $('historyView').hidden = trackerActive;
  $('trackerView').classList.toggle('active', trackerActive);
  $('historyView').classList.toggle('active', !trackerActive);
  $('trackerTab').classList.toggle('active', trackerActive);
  $('historyTab').classList.toggle('active', !trackerActive);
  $('trackerTab').setAttribute('aria-selected', String(trackerActive));
  $('historyTab').setAttribute('aria-selected', String(!trackerActive));
  if (!trackerActive) renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearBetForm(form) {
  form.reset();
  const clearFields = () => {
    $('matchInput').value = '';
    $('marketInput').value = '';
    $('oddsInput').value = '';
    $('stakeInput').value = '';
    $('resultInput').value = 'pending';
    $('formMessage').textContent = '';
  };
  clearFields();
  requestAnimationFrame(() => {
    clearFields();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const match = $('matchInput').value.trim();
  const market = $('marketInput').value.trim();
  const odds = Number($('oddsInput').value);
  const stake = Number($('stakeInput').value);
  const result = $('resultInput').value;
  const allowedResults = new Set(['pending', 'win', 'win_half', 'loss', 'loss_half', 'push']);

  if (!match || !market || !Number.isFinite(odds) || odds < 1.01 || odds > 1000 || !Number.isFinite(stake) || stake <= 0 || stake > 10000000 || !allowedResults.has(result)) {
    $('formMessage').textContent = 'Check Match, Market, Odds and Stake.';
    return;
  }

  await addBet({
    date: state.selectedDate,
    match,
    market,
    odds,
    stake,
    result,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  clearBetForm(form);
  renderAll();
}

async function handleBetAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (!Number.isInteger(id)) return;

  if (button.dataset.action === 'delete') await deleteBet(id);
  else await updateBetResult(id, button.dataset.action);
  renderAll();
}

async function init() {
  if (!('indexedDB' in window)) {
    $('formMessage').textContent = 'This browser does not support local storage required by the app.';
    return;
  }

  state.db = await openDatabase();
  await refreshBets();
  renderAll();
  setActiveTab('tracker');

  $('calendarGrid').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-date]');
    if (!button) return;
    state.selectedDate = button.dataset.date;
    renderAll();
  });

  $('prevMonth').addEventListener('click', () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
    state.selectedDate = dateKey(state.viewYear, state.viewMonth, 1);
    renderAll();
  });

  $('nextMonth').addEventListener('click', () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
    state.selectedDate = dateKey(state.viewYear, state.viewMonth, 1);
    renderAll();
  });

  $('todayButton').addEventListener('click', () => {
    const today = new Date();
    state.viewYear = today.getFullYear();
    state.viewMonth = today.getMonth();
    state.selectedDate = dateKey(state.viewYear, state.viewMonth, today.getDate());
    renderAll();
  });

  $('trackerTab').addEventListener('click', () => setActiveTab('tracker'));
  $('historyTab').addEventListener('click', () => setActiveTab('history'));
  $('viewHistoryButton').addEventListener('click', () => setActiveTab('history'));
  $('backToTrackerButton').addEventListener('click', () => setActiveTab('tracker'));

  document.addEventListener('dblclick', (event) => {
    event.preventDefault();
  }, { passive: false });

  $('betForm').addEventListener('submit', onSubmit);
  $('dayBets').addEventListener('click', handleBetAction);
  $('historyList').addEventListener('click', handleBetAction);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js');
        await registration.update();
      } catch (_) {}
    }, { once: true });
  }
}

init().catch((error) => {
  console.error(error);
  $('formMessage').textContent = 'Could not start the app. Reload and try again.';
});
