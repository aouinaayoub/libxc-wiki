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
  excerptsStatus: 'loading',
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
  // Keyword searches are easier to read in the complete results below.
  if (matches.length && matches.every(match => match.score < 500)) {
    suggestionBox.hidden = true;
    return;
  }
  searchTools.renderSuggestions(suggestionBox, matches, (item) => {
    window.location.href = searchTools.resultHref(item, state.query);
  }, { query: state.query });
}

function updateExcerptPreview(item, show) {
  const passages = show && state.query.trim() ? searchTools?.excerptMatches(item, state.query) || [] : [];
  let container = item.row.querySelector('.excerpt-matches');
  if (!passages.length) { if (container) container.hidden = true; return false; }
  if (!container) {
    container = document.createElement('div');
    container.className = 'excerpt-matches';
    item.row.append(container);
  }
  container.hidden = false;
  container.replaceChildren();
  const label = document.createElement('span');
  label.className = 'excerpt-label';
  label.textContent = passages.length > 1 ? `Review excerpt · ${passages.length} matching passages` : 'Review excerpt';
  const content = document.createElement('div');
  const render = (expanded) => {
    content.replaceChildren();
    for (const passage of expanded ? passages : passages.slice(0, 1)) {
      const paragraph = document.createElement('p');
      searchTools.renderPassage(paragraph, passage, expanded ? Infinity : 320);
      content.append(paragraph);
    }
  };
  render(false);
  container.append(label, content);
  if (passages.length > 1 || passages[0].text.length > 320) {
    const toggle = document.createElement('button');
    toggle.className = 'excerpt-expand';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const moreLabel = passages.length > 1 ? `Show all ${passages.length} passages` : 'Show full passage';
    toggle.textContent = moreLabel;
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Show less' : moreLabel;
      render(expanded);
    });
    container.append(toggle);
  }
  return true;
}

function update() {
  const hasQuery = queryIsActive();
  const hasActiveFilter = filterIsActive();
  const visibleItems = [];
  let excerptResults = 0;

  for (const item of searchIndex) {
    const rowTags = new Set(item.tags);
    const filterMatch = activeFilters().every((tag) => rowTags.has(tag));
    const score = hasQuery ? (searchTools ? searchTools.scoreItem(state.query, item) : fallbackScore(state.query, item)) : 1;
    const show = filterMatch && (!hasQuery || score > 0);
    item.row.toggleAttribute('hidden', !show);
    item.row.classList.toggle('is-hidden', !show);
    item.row.style.order = '';
    if (updateExcerptPreview(item, show)) excerptResults += 1;
    item.row.dataset.resultHref = show && hasQuery ? searchTools?.resultHref(item, state.query) || item.href : item.href;
    if (show) visibleItems.push({ ...item, score });
  }

  if (hasQuery) {
    visibleItems
      .sort((a, b) => searchTools
        ? searchTools.compareMatches({ item: a, score: a.score }, { item: b, score: b.score })
        : b.score - a.score || a.identifier.localeCompare(b.identifier))
      .forEach((item, order) => {
        item.row.style.order = String(order);
      });
  }

  const visible = visibleItems.length;
  if (count) {
    count.textContent = `${visible} result${visible === 1 ? '' : 's'}${hasQuery && excerptResults ? ` · ${excerptResults} with review matches` : ''}`;
    if (hasQuery && state.excerptsStatus === 'loading') count.textContent += ' · Searching excerpts…';
    if (state.excerptsStatus === 'failed') {
      count.append(document.createTextNode(' · Excerpt search unavailable. '));
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'excerpt-expand'; retry.textContent = 'Retry';
      retry.addEventListener('click', loadExcerptSearch);
      count.append(retry);
    }
  }
  const hint = document.querySelector('.results-toolbar > span');
  if (hint) hint.textContent = excerptResults ? 'Open a result to read highlighted matches' : 'Choose a family to browse';
  if (empty) empty.hidden = visible !== 0 || state.excerptsStatus === 'loading';
  for (const tag of tags) {
    tag.classList.toggle('active', state.filters.has(tag.dataset.filter));
    tag.setAttribute('aria-pressed', String(state.filters.has(tag.dataset.filter)));
  }
  if (clearTags) clearTags.hidden = state.filters.size === 0;
  for (const group of groups) {
    const visibleRows = [...group.querySelectorAll('.row-card')].filter((row) => !row.hidden);
    const hasVisibleRows = visibleRows.length > 0;
    const groupCount = group.querySelector('.rung-count');
    if (groupCount) groupCount.textContent = String(visibleRows.length);
    group.hidden = !hasVisibleRows;
    group.style.order = hasQuery && hasVisibleRows
      ? String(Math.min(...visibleRows.map(row => Number(row.style.order))))
      : '';
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
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
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
    if (window.getSelection()?.toString()) return;
    window.location.href = row.dataset.resultHref || row.dataset.href;
  });
  row.addEventListener('keydown', (event) => {
    if (event.target !== row) return;
    if (event.key === 'Enter') window.location.href = row.dataset.resultHref || row.dataset.href;
  });
}

update();

document.querySelector('#reset-search')?.addEventListener('click', () => {
  state.filters.clear();
  search.value = '';
  search.dispatchEvent(new Event('input'));
  search.focus();
});

function loadExcerptSearch() {
  state.excerptsStatus = 'loading';
  update();
  searchTools.loadExcerpts(searchIndex).then(() => {
    state.excerptsStatus = 'ready';
    update();
  }).catch(() => {
    state.excerptsStatus = 'failed';
    update();
  });
}
if (searchTools) loadExcerptSearch();
