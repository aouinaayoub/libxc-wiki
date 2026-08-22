const rows = [...document.querySelectorAll('.row-card')];
const groups = [...document.querySelectorAll('.rung-section')];
const search = document.querySelector('#search');
const suggestionBox = document.querySelector('#search-suggestions');
const tags = [...document.querySelectorAll('.filter-tag[data-filter]')];
const clearTags = document.querySelector('#clear-tags');
const count = document.querySelector('#result-count');
const empty = document.querySelector('#empty-results');
const searchTools = window.LibxcSearch;
const filterGroups = {
  rung: new Set(['lda', 'gga', 'meta-gga', 'hybrid']),
  dimension: new Set(['dim1', 'dim2']),
};
const searchIndex = rows.map((row, index) => ({
  index,
  row,
  identifier: row.dataset.identifier || row.querySelector('.identifier')?.textContent || '',
  href: row.dataset.href,
  authorSummary: row.dataset.authors || '',
  tags: (row.dataset.tags || '').split(' ').filter(Boolean),
  search: row.dataset.search || '',
}));

const state = {
  query: '',
  filters: new Set(),
};

const initialQuery = new URLSearchParams(window.location.search).get('q') || '';
if (search && initialQuery) {
  search.value = initialQuery;
  state.query = initialQuery;
}
searchTools?.bindSuggestionKeyboard(search, suggestionBox);
searchTools?.setupCommandPalette({ items: searchIndex });

for (const group of groups) {
  const toggle = group.querySelector('.rung-toggle');
  toggle?.addEventListener('click', () => {
    const collapsed = !group.classList.contains('is-collapsed');
    if (filterIsActive()) {
      group.classList.toggle('is-filter-collapsed', collapsed);
    } else {
      group.classList.toggle('is-user-collapsed', collapsed);
    }
    setGroupCollapsed(group, collapsed);
  });
}

function queryIsActive() {
  return Boolean(state.query.trim());
}

function activeFilters() {
  return [...state.filters];
}

function filterGroup(value) {
  return Object.values(filterGroups).find((group) => group.has(value));
}

function toggleFilter(value) {
  if (state.filters.has(value)) {
    state.filters.delete(value);
    return;
  }

  if (value === 'kinetic') {
    state.filters.delete('exchange');
    state.filters.delete('correlation');
  } else if (value === 'exchange' || value === 'correlation') {
    state.filters.delete('kinetic');
  }

  const group = filterGroup(value);
  if (group) {
    for (const existing of group) {
      state.filters.delete(existing);
    }
  }
  state.filters.add(value);
}

function filterIsActive() {
  return queryIsActive() || state.filters.size > 0;
}

function setGroupCollapsed(group, collapsed) {
  group.classList.toggle('is-collapsed', collapsed);
  group.querySelector('.rung-toggle')?.setAttribute('aria-expanded', String(!collapsed));
}

function clearFilterCollapseState() {
  for (const group of groups) {
    group.classList.remove('is-filter-collapsed');
  }
}

function fallbackScore(query, item) {
  const needle = String(query || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compactNeedle = needle.replace(/\s+/g, '');
  const haystack = String(item.search || item.identifier || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ');
  const compactHaystack = haystack.replace(/\s+/g, '');
  return haystack.includes(needle) || compactHaystack.includes(compactNeedle) ? 1 : 0;
}

function updateSuggestions() {
  if (!searchTools || !suggestionBox || !queryIsActive()) {
    if (suggestionBox) suggestionBox.hidden = true;
    return;
  }

  const matches = searchTools.search(searchIndex, state.query, {
    filters: activeFilters(),
  });
  searchTools.renderSuggestions(suggestionBox, matches, (item) => {
    window.location.href = item.href;
  });
}

function update() {
  const hasQuery = queryIsActive();
  const hasActiveFilter = filterIsActive();
  const visibleItems = [];

  for (const item of searchIndex) {
    const rowTags = new Set(item.tags);
    const filterMatch = activeFilters().every((tag) => rowTags.has(tag));
    const score = hasQuery ? (searchTools ? searchTools.scoreItem(state.query, item) : fallbackScore(state.query, item)) : 1;
    const show = filterMatch && (!hasQuery || score > 0);
    item.row.toggleAttribute('hidden', !show);
    item.row.classList.toggle('is-hidden', !show);
    item.row.style.order = '';
    if (show) visibleItems.push({ ...item, score });
  }

  if (hasQuery) {
    visibleItems
      .sort((a, b) => b.score - a.score || a.identifier.localeCompare(b.identifier))
      .forEach((item, order) => {
        item.row.style.order = String(order);
      });
  }

  const visible = visibleItems.length;
  if (count) count.textContent = `${visible} result${visible === 1 ? '' : 's'}`;
  if (empty) empty.hidden = visible !== 0;
  for (const tag of tags) {
    tag.classList.toggle('active', state.filters.has(tag.dataset.filter));
  }
  if (clearTags) clearTags.hidden = state.filters.size === 0;
  for (const group of groups) {
    const visibleRows = [...group.querySelectorAll('.row-card')].filter((row) => !row.hidden);
    const hasVisibleRows = visibleRows.length > 0;
    const groupCount = group.querySelector('.rung-count');
    if (groupCount) groupCount.textContent = String(visibleRows.length);
    group.hidden = !hasVisibleRows;
    const collapsed = hasActiveFilter
      ? group.classList.contains('is-filter-collapsed')
      : group.classList.contains('is-user-collapsed');
    setGroupCollapsed(group, collapsed);
  }
  updateSuggestions();
}

search?.addEventListener('input', () => {
  state.query = search.value;
  clearFilterCollapseState();
  const url = new URL(window.location.href);
  if (state.query.trim()) {
    url.searchParams.set('q', state.query.trim());
  } else {
    url.searchParams.delete('q');
  }
  window.history.replaceState({}, '', url);
  update();
});

search?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.filters.size > 0) {
      state.filters.clear();
      clearFilterCollapseState();
      update();
      return;
    }
    search.value = '';
    state.query = '';
    clearFilterCollapseState();
    if (suggestionBox) suggestionBox.hidden = true;
    update();
  }
});

search?.addEventListener('focus', updateSuggestions);

document.addEventListener('click', (event) => {
  if (!suggestionBox || event.target.closest('.search-box')) return;
  suggestionBox.hidden = true;
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || state.filters.size === 0 || event.target === search) return;
  state.filters.clear();
  clearFilterCollapseState();
  update();
});

clearTags?.addEventListener('click', () => {
  state.filters.clear();
  clearFilterCollapseState();
  update();
});

for (const tag of tags) {
  tag.addEventListener('click', (event) => {
    event.stopPropagation();
    if (tag.disabled) return;
    const value = tag.dataset.filter;
    toggleFilter(value);
    clearFilterCollapseState();
    update();
  });
}

for (const row of rows) {
  row.addEventListener('click', () => {
    window.location.href = row.dataset.href;
  });
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') window.location.href = row.dataset.href;
  });
}

update();
