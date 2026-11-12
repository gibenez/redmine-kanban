import { sprintFilterChoices, sprintFiltersActive } from './sprint-filters.js';

// Preserve the search node and unchanged option lists across board rerenders.
export function createSprintFilterControls(root, onChange) {
  const query = root.querySelector('input[type="search"]');
  let current;
  function positionOptions(details) {
    const list = details.querySelector('.sprint-filter-options'), bounds = details.getBoundingClientRect();
    list.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - list.offsetWidth - 8))}px`;
    list.style.top = `${bounds.bottom + 4}px`;
  }
  query.addEventListener('input', () => { current.query = query.value; onChange(); });
  root.querySelector('[data-clear-sprint]').addEventListener('click', () => {
    current.query = '';
    for (const key of ['project', 'assignee', 'priority', 'tag']) current[key] = [];
    onChange(); query.focus();
  });
  for (const details of root.querySelectorAll('details')) {
    details.addEventListener('toggle', () => {
      if (details.open) {
        for (const other of root.querySelectorAll('details')) if (other !== details) other.open = false;
        positionOptions(details);
      }
    });
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape') { details.open = false; details.querySelector('summary').focus(); event.stopPropagation(); }
    });
    details.addEventListener('change', () => {
      current[details.dataset.filter] = [...details.querySelectorAll('input:checked')].map(input => input.value);
      onChange();
    });
  }
  document.addEventListener('click', event => {
    for (const details of root.querySelectorAll('details[open]')) if (!details.contains(event.target)) details.open = false;
  });
  window.addEventListener('resize', () => {
    for (const details of root.querySelectorAll('details[open]')) positionOptions(details);
  });
  return (filters, cards, visible, tagChoices = []) => {
    current = filters;
    if (query.value !== filters.query) query.value = filters.query;
    for (const details of root.querySelectorAll('details')) {
      const key = details.dataset.filter, list = details.querySelector('.sprint-filter-options');
      const choices = key === 'tag' ? [...tagChoices] : sprintFilterChoices(cards, key), known = new Set(choices.map(([id]) => id));
      for (const id of filters[key]) if (!known.has(id)) choices.push([id, key === 'tag' ? `${id} (not in this Sprint)` : id === 'none' ? 'Unassigned (not in this Sprint)' : `${key} #${id} (not in this Sprint)`]);
      // Do not remove the focused checkbox during its change event. Keep absent
      // choices removable/reselectable until the open dropdown is dismissed.
      if (details.open) for (const input of list.querySelectorAll('input')) {
        if (!choices.some(([id]) => id === input.value)) choices.push([input.value, input.parentElement.textContent]);
      }
      const signature = JSON.stringify(choices);
      if (list.dataset.choices !== signature) {
        list.replaceChildren(...choices.map(([id, name]) => {
          const label = document.createElement('label'), input = document.createElement('input');
          input.type = 'checkbox'; input.value = id;
          label.append(input, document.createTextNode(name)); return label;
        }));
        if (!choices.length) { const empty = document.createElement('span'); empty.textContent = 'No choices in this Sprint'; list.append(empty); }
        list.dataset.choices = signature;
      }
      for (const input of list.querySelectorAll('input')) input.checked = filters[key].includes(input.value);
      details.querySelector('summary').textContent = `${key[0].toUpperCase() + key.slice(1)}: ${filters[key].length || 'All'}`;
      if (details.open) positionOptions(details);
    }
    root.querySelector('[data-sprint-count]').textContent = `Showing ${visible.length} of ${cards.length} Cards`;
    const active = sprintFiltersActive(filters);
    root.querySelector('[data-clear-sprint]').hidden = !active;
    root.querySelector('[data-sprint-empty]').hidden = !active || visible.length > 0;
  };
}
