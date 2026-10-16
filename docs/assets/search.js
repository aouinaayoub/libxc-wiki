(function () {
  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, '');
  }

  function fuzzyScore(query, target) {
    if (!query) return 0;
    let score = 0;
    let queryIndex = 0;
    let previousMatch = -1;

    for (let targetIndex = 0; targetIndex < target.length && queryIndex < query.length; targetIndex += 1) {
      if (target[targetIndex] !== query[queryIndex]) continue;

      const gap = previousMatch < 0 ? targetIndex : targetIndex - previousMatch - 1;
      score += 12;
      if (gap === 0) score += 10;
      if (targetIndex === 0 || target[targetIndex - 1] === ' ') score += 6;
      score -= Math.min(gap, 8);
      previousMatch = targetIndex;
      queryIndex += 1;
    }

    if (queryIndex !== query.length) return 0;
    return Math.max(1, score - target.length * 0.02);
  }

  const preparedExcerpts = new WeakMap();
  const wordScores = new Map();
  const rootCache = new Map();
  const suffixes = ['izations', 'isations', 'ization', 'isation', 'ically', 'ations', 'ation', 'izing', 'ising', 'ized', 'ised', 'ical', 'isms', 'ism', 'ics', 'ic', 'ness', 'ing', 'ies', 'es', 's'];
  const fold = word => word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const words = text => [...String(text || '').matchAll(/[\p{L}\p{N}]+/gu)]
    .map(match => ({ word: fold(match[0]), start: match.index, end: match.index + match[0].length }));

  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    let beforePrevious;
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] !== b[j - 1]));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
        }
      }
      if (Math.min(...current) > limit) return limit + 1;
      beforePrevious = previous;
      previous = current;
    }
    return previous[b.length];
  }

  function stem(word) {
    const suffix = suffixes.find(ending => word.endsWith(ending) && word.length - ending.length >= 5);
    return suffix ? word.slice(0, -suffix.length) : word;
  }

  function queryRoots(word) {
    if (rootCache.has(word)) return rootCache.get(word);
    const root = stem(word);
    const roots = new Set([root]);
    // Also tolerate a small typo in a morphological ending, e.g. "magnetisim".
    if (root === word && word.length >= 8) {
      for (const ending of suffixes.filter(suffix => suffix.length >= 3)) {
        for (const length of [ending.length - 1, ending.length, ending.length + 1]) {
          if (word.length - length >= 5 && distance(word.slice(-length), ending, 1) <= 1) roots.add(word.slice(0, -length));
        }
      }
    }
    if (rootCache.size > 100) rootCache.clear();
    rootCache.set(word, [...roots]);
    return rootCache.get(word);
  }

  function wordScore(term, word) {
    if (term === word) return 4;
    if (term.length >= 3 && word.includes(term)) return 3;
    if (term.length < 5) return 0;
    const key = `${term}:${word}`;
    if (wordScores.has(key)) return wordScores.get(key);
    const root = stem(word);
    let score = 0;
    for (const candidate of queryRoots(term)) {
      if (root === candidate || (candidate.length >= 5 && root.endsWith(candidate))) { score = 3; break; }
      // Prefixes such as ferro-/para- retain the searchable magnetic root.
      const endings = [root, root.slice(-candidate.length), root.slice(-candidate.length - 1), root.slice(-candidate.length + 1)];
      if (endings.some(ending => ending.length >= 5 && distance(candidate, ending, 1) <= 1)) score = Math.max(score, 2);
    }
    const tolerance = term.length >= 8 ? 2 : 1;
    if (!score && distance(term, word, tolerance) <= tolerance) score = 2;
    if (wordScores.size >= 30000) wordScores.clear();
    wordScores.set(key, score);
    return score;
  }

  function excerptData(item) {
    if (!preparedExcerpts.has(item)) {
      const paragraphs = (item.excerpts || []).map(text => ({ text, words: words(text) }));
      preparedExcerpts.set(item, paragraphs);
    }
    return preparedExcerpts.get(item);
  }

  function excerptMatches(item, query) {
    const terms = [...new Set(words(query).map(token => token.word))];
    if (!terms.length) return [];
    return excerptData(item).flatMap(paragraph => {
      const ranges = paragraph.words.filter(token => terms.some(term => wordScore(term, token.word)));
      return ranges.length ? [{ text: paragraph.text, ranges }] : [];
    });
  }

  function excerptScore(item, query) {
    const tokens = excerptData(item).flatMap(paragraph => paragraph.words);
    const best = Math.max(0, ...tokens.map(token => wordScore(query, token.word)));
    return best ? 280 + best * 25 : 0;
  }

  function appendHighlighted(container, text, ranges) {
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      container.append(document.createTextNode(text.slice(cursor, range.start)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(range.start, range.end);
      mark.dataset.searchMatch = '';
      container.append(mark);
      cursor = range.end;
    }
    container.append(document.createTextNode(text.slice(cursor)));
  }

  function renderPassage(container, passage, maxLength = 300) {
    const focus = passage.ranges[0].start;
    let start = maxLength === Infinity ? 0 : Math.max(0, focus - 95);
    if (start) { const boundary = passage.text.indexOf(' ', start); if (boundary >= 0 && boundary < focus) start = boundary + 1; }
    let end = Math.min(passage.text.length, Math.max(start + maxLength, passage.ranges[0].end));
    if (end < passage.text.length) { const boundary = passage.text.lastIndexOf(' ', end); if (boundary > focus) end = boundary; }
    const text = passage.text.slice(start, end);
    const ranges = passage.ranges.filter(range => range.start >= start && range.end <= end)
      .map(range => ({ start: range.start - start, end: range.end - start }));
    if (start) container.append(document.createTextNode('… '));
    appendHighlighted(container, text, ranges);
    if (end < passage.text.length) container.append(document.createTextNode(' …'));
  }

  function resultHref(item, query) {
    if (!query || !excerptMatches(item, query).length) return item.href;
    const url = new URL(item.href, document.baseURI);
    url.searchParams.set('highlight', query);
    url.hash = 'review-excerpt';
    return url.href;
  }

  const excerptRequests = new Map();
  function loadExcerpts(items) {
    const script = document.querySelector('script[src*="assets/search.js"]');
    const url = new URL('../data/excerpts.json', script.src);
    url.search = new URL(script.src).search;
    if (!excerptRequests.has(url.href)) {
      excerptRequests.set(url.href, fetch(url).then(response => {
        if (!response.ok) throw new Error('Excerpt search unavailable');
        return response.json();
      }).catch(error => { excerptRequests.delete(url.href); throw error; }));
    }
    return excerptRequests.get(url.href).then(data => {
      for (const item of items) {
        item.excerpts = data.excerpts[item.identifier] || [];
        preparedExcerpts.delete(item);
      }
      document.dispatchEvent(new Event('libxc-excerpts-ready'));
    });
  }

  function highlightReview(root, query) {
    if (!root || !query) return 0;
    const terms = words(query).map(token => token.word);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      return node.parentElement.closest('.katex, .equation, .equation-preview, .citation-marker, mark, script, style')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    for (const node of nodes) {
      const ranges = words(node.textContent).filter(token => terms.some(term => wordScore(term, token.word)));
      if (!ranges.length) continue;
      const fragment = document.createDocumentFragment();
      appendHighlighted(fragment, node.textContent, ranges);
      node.replaceWith(fragment);
      count += ranges.length;
    }
    return count;
  }

  function scoreItem(rawQuery, item) {
    const query = normalize(rawQuery);
    const queryCompact = compact(rawQuery);
    if (!query) return 0;

    const terms = query.split(' ').filter(Boolean);
    if (terms.length > 1) {
      let total = 0;
      for (const term of terms) {
        const termScore = scoreItem(term, item);
        if (termScore <= 0) return 0;
        total += termScore;
      }
      return total + 80;
    }

    const identifier = normalize(item.identifier);
    const identifierCompact = compact(item.identifier);
    const haystack = normalize(item.search);
    const haystackCompact = compact(item.search);
    const tags = (item.tags || []).map(normalize);
    const functionalName = normalize(String(item.identifier || '').replace(/^(?:hyb_)?(?:lda|gga|mgga)_[xck]+_/i, ''));
    let score = excerptScore(item, query);

    if (identifier === query || identifierCompact === queryCompact) score = Math.max(score, 1000);
    // Match the functional name itself before variants such as SCAN0 or rSCAN.
    if (functionalName === query || compact(functionalName) === queryCompact) score = Math.max(score, 960);
    if (identifier.startsWith(query) || identifierCompact.startsWith(queryCompact)) score = Math.max(score, 900 - identifier.length);
    if (identifier.includes(query) || identifierCompact.includes(queryCompact)) score = Math.max(score, 760 - identifier.indexOf(query));
    if (tags.includes(query)) score = Math.max(score, 680);
    if (haystack.includes(query) || haystackCompact.includes(queryCompact)) score = Math.max(score, 520);

    if (queryCompact.length <= 4) return score;

    const identifierScore = fuzzyScore(queryCompact, identifierCompact);
    if (identifierScore > 0) score = Math.max(score, identifierScore + 260);

    return score;
  }

  function kindPriority(item) {
    const tags = new Set(item.tags || []);
    if (tags.has('exchange')) return tags.has('correlation') ? 1 : 0;
    if (tags.has('correlation')) return 2;
    if (tags.has('kinetic')) return 3;
    return 4;
  }

  // Keep relevance first; prefer exchange when matches are equally relevant.
  function compareMatches(a, b) {
    return b.score - a.score
      || kindPriority(a.item) - kindPriority(b.item)
      || a.item.identifier.localeCompare(b.item.identifier);
  }

  function search(items, rawQuery, options = {}) {
    const filters = options.filters || [];
    const limit = options.limit ?? Infinity;
    const scored = [];

    for (const item of items) {
      const itemTags = new Set(item.tags || []);
      if (!filters.every((tag) => itemTags.has(tag))) continue;

      const score = scoreItem(rawQuery, item);
      if (score <= 0) continue;
      scored.push({ item, score });
    }

    scored.sort(compareMatches);
    return scored.slice(0, limit);
  }

  function renderSuggestions(container, matches, onChoose, { query = '' } = {}) {
    if (!container) return;
    container.replaceChildren();
    if (!matches.length) {
      container.hidden = true;
      return;
    }

    container.setAttribute('aria-label', `${matches.length} matching functionals`);
    const count = document.createElement('div');
    count.className = 'suggestion-count';
    count.setAttribute('role', 'presentation');
    count.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}${matches.length > 7 ? ' · Scroll for more' : ''}`;
    container.append(count);
    container.scrollTop = 0;

    for (const match of matches) {
      const button = document.createElement('button');
      button.className = 'suggestion';
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'option');

      const code = document.createElement('code');
      code.textContent = match.item.identifier;

      const meta = document.createElement('span');
      meta.textContent = [match.item.authorSummary, (match.item.tags || []).join(' ')].filter(Boolean).join(' - ');

      button.append(code, meta);
      const passage = excerptMatches(match.item, query)[0];
      if (passage) {
        const snippet = document.createElement('p');
        snippet.className = 'suggestion-excerpt';
        renderPassage(snippet, passage, 210);
        button.append(snippet);
      }
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => onChoose(match.item));
      container.append(button);
    }

    container.hidden = false;
  }

  function suggestionButtons(container) {
    return [...(container?.querySelectorAll('.suggestion') || [])];
  }

  function focusSuggestion(container, index) {
    const buttons = suggestionButtons(container);
    if (!buttons.length) return false;
    const nextIndex = (index + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    return true;
  }

  function bindSuggestionKeyboard(input, container) {
    if (!input || !container) return;

    input.addEventListener('keydown', (event) => {
      if (container.hidden) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusSuggestion(container, 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusSuggestion(container, suggestionButtons(container).length - 1);
      }
    });

    container.addEventListener('keydown', (event) => {
      const buttons = suggestionButtons(container);
      const current = buttons.indexOf(document.activeElement);
      if (!buttons.length || current < 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusSuggestion(container, current + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusSuggestion(container, current - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusSuggestion(container, 0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusSuggestion(container, buttons.length - 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        container.hidden = true;
        input.focus();
      }
    });
  }

  function setupCommandPalette(options = {}) {
    const palette = document.querySelector('#command-palette');
    const input = document.querySelector('#command-search');
    const suggestions = document.querySelector('#command-search-suggestions');
    const panel = document.querySelector('.command-panel');
    if (!palette || !input || !suggestions || !panel) return;

    const getItems = options.getItems || (() => options.items || []);
    let matches = [];

    const close = () => {
      palette.hidden = true;
      palette.setAttribute('aria-hidden', 'true');
      input.value = '';
      suggestions.hidden = true;
    };

    const open = () => {
      palette.hidden = false;
      palette.setAttribute('aria-hidden', 'false');
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    };

    const update = () => {
      const query = input.value.trim();
      if (!query) {
        suggestions.hidden = true;
        suggestions.replaceChildren();
        matches = [];
        return;
      }

      matches = search(getItems(), query);
      renderSuggestions(suggestions, matches, (item) => {
        window.location.href = resultHref(item, query);
      }, { query });
    };

    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        open();
      } else if (event.key === 'Escape' && !palette.hidden) {
        event.preventDefault();
        close();
      }
    });

    palette.addEventListener('click', (event) => {
      if (event.target.matches('[data-command-close]')) close();
    });

    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      if (matches[0]) window.location.href = resultHref(matches[0].item, input.value);
    });

    input.addEventListener('input', update);
    document.addEventListener('libxc-excerpts-ready', () => { if (!palette.hidden) update(); });
    bindSuggestionKeyboard(input, suggestions);
  }

  window.LibxcSearch = {
    normalize,
    loadExcerpts,
    excerptMatches,
    renderPassage,
    resultHref,
    highlightReview,
    scoreItem,
    compareMatches,
    search,
    renderSuggestions,
    bindSuggestionKeyboard,
    setupCommandPalette,
  };
}());
