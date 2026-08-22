const mathMacros = {
  '\\I': '\\mathrm{i}',
  '\\D': '\\mathrm{d}',
  '\\E': '\\mathrm{e}',
  '\\Eh': 'E_{\\mathrm{h}}',
  '\\c': '\\mathrm{c}',
  '\\x': '\\mathrm{x}',
  '\\xc': '\\mathrm{xc}',
  '\\Hx': '\\mathrm{Hx}',
  '\\Hxc': '\\mathrm{Hxc}',
  '\\br': '\\vec{r}',
  '\\bk': '\\vec{k}',
  '\\bq': '\\vec{q}',
  '\\bx': '\\vec{x}',
  '\\bu': '\\vec{u}',
  '\\bs': '\\vec{s}',
  '\\bR': '\\vec{R}',
  '\\balpha': '\\vec{\\alpha}',
  '\\bC': '\\vec{C}',
  '\\bD': '\\vec{D}',
  '\\bff': '\\vec{f}',
  '\\bg': '\\vec{g}',
  '\\bG': '\\vec{G}',
  '\\bj': '\\vec{j}',
  '\\bS': '\\vec{S}',
  '\\bX': '\\vec{X}',
  '\\bY': '\\vec{Y}',
  '\\erf': '\\operatorname{erf}',
  '\\erfc': '\\operatorname{erfc}',
  '\\arcsinh': '\\operatorname{arcsinh}',
  '\\sech': '\\operatorname{sech}',
  '\\dilog': '\\operatorname{L}_2',
  '\\mint': '\\int\\! \\mathrm{d}^{3} #1\\,',
  '\\mdint': '\\int\\! \\mathrm{d}^{3} #1\\,\\!\\!\\!\\int\\! \\mathrm{d}^{3} #2\\,',
  '\\EquivTo': '\\underset{#1}{\\sim}',
};

function renderEquations() {
  document.querySelectorAll('.equation[data-tex]').forEach((node) => {
    katex.render(node.dataset.tex, node, {
      displayMode: true,
      throwOnError: false,
      strict: false,
      macros: mathMacros,
    });
  });

  document.querySelectorAll('.equation-preview-math[data-tex]').forEach((node) => {
    katex.render(node.dataset.tex, node, {
      displayMode: true,
      throwOnError: false,
      strict: false,
      macros: mathMacros,
    });
  });

  renderMathInElement(document.body, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true },
    ],
    throwOnError: false,
    strict: false,
    macros: mathMacros,
  });
}

function fallbackCopyText(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.width = '1px';
  area.style.height = '1px';
  area.style.padding = '0';
  area.style.border = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) {
    throw new Error('Copy command failed');
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      fallbackCopyText(text);
      return;
    }
  }

  fallbackCopyText(text);
}

function setupCopyButtons() {
  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;

    button.addEventListener('click', async () => {
      const initialLabel = button.textContent;
      button.disabled = true;
      try {
        await copyText(target.textContent);
        button.textContent = 'Copied';
        button.classList.add('copied');
      } catch {
        button.textContent = 'Failed';
      }

      window.setTimeout(() => {
        button.textContent = initialLabel;
        button.classList.remove('copied');
        button.disabled = false;
      }, 1400);
    });
  });
}

function setupGlobalSearch() {
  const form = document.querySelector('.global-search');
  const input = document.querySelector('.global-search-input');
  const suggestionBox = document.querySelector('#global-search-suggestions');
  const searchTools = window.LibxcSearch;
  if (!form || !input) return;
  searchTools?.bindSuggestionKeyboard(input, suggestionBox);

  let index = [];
  searchTools?.setupCommandPalette({ getItems: () => index });

  fetch('../../data/functionals.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      index = (data?.functionals || []).map((item) => ({
        identifier: item.identifier,
        href: `../../functionals/${item.slug}/`,
        authorSummary: item.authorSummary || '',
        tags: item.tags || [],
        search: item.search || item.identifier,
      }));
      updateSuggestions();
    })
    .catch(() => {});

  const updateSuggestions = () => {
    if (!searchTools || !suggestionBox || !input.value.trim()) {
      if (suggestionBox) suggestionBox.hidden = true;
      return;
    }

    const matches = searchTools.search(index, input.value);
    searchTools.renderSuggestions(suggestionBox, matches, (item) => {
      window.location.href = item.href;
    });
  };

  const goToSearch = () => {
    const query = input.value.trim();
    window.location.href = query ? `../../?q=${encodeURIComponent(query)}` : '../../';
  };

  input.addEventListener('input', updateSuggestions);
  input.addEventListener('focus', updateSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    input.value = '';
    if (suggestionBox) suggestionBox.hidden = true;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    goToSearch();
  });

  document.addEventListener('click', (event) => {
    if (!suggestionBox || event.target.closest('.global-search')) return;
    suggestionBox.hidden = true;
  });
}

function setupEscapeToHome() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (event.defaultPrevented) return;
    const palette = document.querySelector('#command-palette');
    if (palette && !palette.hidden) return;
    window.location.href = '../../';
  });
}

try {
  renderEquations();
} catch (error) {
  console.warn('Math rendering failed:', error);
}
setupCopyButtons();
setupGlobalSearch();
setupEscapeToHome();
