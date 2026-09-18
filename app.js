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

function profitForBet(bet) {
  if (bet.result === 'win') return bet.stake * (bet.odds - 1);
  if (bet.result === 'loss') return -bet.stake;
  return 0;
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
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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

function renderSelectedDay() {
  const stats = statsForDate(state.selectedDate);
  const { year, month, day } = parseDateKey(state.selectedDate);
  const date = new Date(year, month, day);

  $('selectedDateTitle').textContent = date.toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  $('selectedDaySummary').textContent = stats.list.length
    ? `${stats.list.length} bets · Stake ${money(stats.stake)} · P/L ${signedMoney(stats.pl)} · ROI ${stats.roi > 0 ? '+' : ''}${stats.roi.toFixed(1)}%`
    : 'No bets yet';

  const list = $('dayBets');
  list.replaceChildren();

  if (!stats.list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No bets for this day';
    list.appendChild(empty);
    return;
  }

  stats.list.forEach((bet) => {
    const pl = profitForBet(bet);
    const card = document.createElement('article');
    card.className = 'bet-card';
    if (bet.result === 'win') card.classList.add('win');
    if (bet.result === 'loss') card.classList.add('loss');

    const tone = pl > 0 ? 'positive' : pl < 0 ? 'negative' : '';
    const statusTone = bet.result === 'win' ? 'positive' : bet.result === 'loss' ? 'negative' : '';
    card.innerHTML = `
      <div class="bet-card-main">
        <div class="bet-card-copy">
          <strong>${escapeHTML(bet.match)}</strong>
          <div class="bet-meta">${escapeHTML(bet.market)} · @${bet.odds.toFixed(2)} · ${money(bet.stake)}</div>
        </div>
        <div class="bet-result ${tone}">
          <span class="bet-status ${statusTone}">${bet.result.toUpperCase()}</span>
          <span>${bet.result === 'pending' ? '—' : signedMoney(pl)}</span>
        </div>
      </div>
      <div class="bet-actions">
        <button type="button" data-action="win" data-id="${bet.id}" class="positive">Win</button>
        <button type="button" data-action="loss" data-id="${bet.id}" class="negative">Loss</button>
        <button type="button" data-action="push" data-id="${bet.id}">Push</button>
        <button type="button" data-action="delete" data-id="${bet.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function renderAll() {
  renderCalendar();
  renderSelectedDay();
}

async function onSubmit(event) {
  event.preventDefault();
  const match = $('matchInput').value.trim();
  const market = $('marketInput').value.trim();
  const odds = Number($('oddsInput').value);
  const stake = Number($('stakeInput').value);
  const result = $('resultInput').value;

  if (!match || !market || !Number.isFinite(odds) || odds < 1.01 || odds > 1000 || !Number.isFinite(stake) || stake <= 0 || stake > 10000000) {
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

  event.currentTarget.reset();
  $('resultInput').value = 'pending';
  $('formMessage').textContent = 'Bet added.';
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

  // Prevent double-click / double-tap zoom from hijacking app interactions.
  document.addEventListener('dblclick', (event) => {
    event.preventDefault();
  }, { passive: false });

  $('betForm').addEventListener('submit', onSubmit);

  $('dayBets').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (!Number.isInteger(id)) return;

    if (button.dataset.action === 'delete') await deleteBet(id);
    else await updateBetResult(id, button.dataset.action);
    renderAll();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }, { once: true });
  }
}

init().catch((error) => {
  console.error(error);
  $('formMessage').textContent = 'Could not start the app. Reload and try again.';
});
