(function () {
  const MAX_SUGGESTIONS = 7;

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
    let score = 0;

    if (identifier === query || identifierCompact === queryCompact) score = Math.max(score, 1000);
    if (identifier.startsWith(query) || identifierCompact.startsWith(queryCompact)) score = Math.max(score, 900 - identifier.length);
    if (identifier.includes(query) || identifierCompact.includes(queryCompact)) score = Math.max(score, 760 - identifier.indexOf(query));
    if (tags.includes(query)) score = Math.max(score, 680);
    if (haystack.includes(query) || haystackCompact.includes(queryCompact)) score = Math.max(score, 520);

    if (queryCompact.length <= 4) return score;

    score = Math.max(score, fuzzyScore(queryCompact, identifierCompact) + 260);
    score = Math.max(score, fuzzyScore(queryCompact, haystackCompact));
    return score;
  }

  function search(items, rawQuery, options = {}) {
    const filters = options.filters || [];
    const limit = options.limit || MAX_SUGGESTIONS;
    const scored = [];

    for (const item of items) {
      const itemTags = new Set(item.tags || []);
      if (!filters.every((tag) => itemTags.has(tag))) continue;

      const score = scoreItem(rawQuery, item);
      if (score <= 0) continue;
      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score || a.item.identifier.localeCompare(b.item.identifier));
    return scored.slice(0, limit);
  }

  function renderSuggestions(container, matches, onChoose) {
    if (!container) return;
    container.replaceChildren();
    if (!matches.length) {
      container.hidden = true;
      return;
    }

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
        window.location.href = item.href;
      });
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
      if (matches[0]) window.location.href = matches[0].item.href;
    });

    input.addEventListener('input', update);
    bindSuggestionKeyboard(input, suggestions);
  }

  window.LibxcSearch = {
    normalize,
    scoreItem,
    search,
    renderSuggestions,
    bindSuggestionKeyboard,
    setupCommandPalette,
  };
}());
