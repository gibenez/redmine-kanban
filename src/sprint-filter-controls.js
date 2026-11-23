import { sprintFilterChoices, sprintFiltersActive } from './sprint-filters.js';
import { projectColor } from './project-colors.js';
import { projectSwatch } from './project-summary.js';

// Preserve the search node and unchanged option lists across board rerenders.
export function createSprintFilterControls(root, onChange) {
  const query = root.querySelector('input[type="search"]');
  let current;
  function positionOptions(details) {
    const list = details.querySelector('.sprint-filter-options'), bounds = details.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 12, above = bounds.top - 12;
    const preferredHeight = Math.min(320, window.innerHeight * .45, list.scrollHeight);
    const opensAbove = below < preferredHeight && above > below;
    list.style.maxHeight = `${Math.max(0, Math.min(320, window.innerHeight * .45, opensAbove ? above : below))}px`;
    list.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - list.offsetWidth - 8))}px`;
    list.style.top = `${opensAbove ? bounds.top - list.offsetHeight - 4 : bounds.bottom + 4}px`;
  }
  function closeFilters() {
    for (const details of root.querySelectorAll('details[open]')) details.open = false;
  }
  function repositionOpenFilters() {
    const controls = root.querySelector('[data-sprint-controls]'), clip = controls.getBoundingClientRect();
    for (const details of root.querySelectorAll('details[open]')) {
      const bounds = details.getBoundingClientRect();
      if (bounds.right <= clip.left || bounds.left >= clip.right || bounds.bottom <= 0 || bounds.top >= window.innerHeight) details.open = false;
      else positionOptions(details);
    }
  }
  query.addEventListener('input', () => { current.query = query.value; onChange(); });
  root.querySelector('[data-clear-sprint]').addEventListener('click', () => {
    current.query = '';
    for (const key of ['project', 'assignee', 'priority', 'tag']) current[key] = [];
    closeFilters(); onChange(); query.focus();
  });
  for (const details of root.querySelectorAll('details')) {
    details.querySelector('summary').addEventListener('click', event => {
      // Position in the activation event, not the deferred native toggle event,
      // so a scrolled dropdown never flashes outside the viewport on opening.
      event.preventDefault();
      const open = !details.open;
      closeFilters(); details.open = open;
      if (open) positionOptions(details);
    });
    details.querySelector('[data-clear-filter]').addEventListener('click', () => {
      current[details.dataset.filter] = [];
      details.open = false;
      onChange(); details.querySelector('summary').focus();
    });
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
  window.addEventListener('resize', repositionOpenFilters);
  // Fixed panels follow their anchor when the compact control strip scrolls.
  root.addEventListener('scroll', repositionOpenFilters, { capture: true, passive: true });
  return (filters, cards, visible, tagChoices = [], projects = []) => {
    current = filters;
    if (query.value !== filters.query) query.value = filters.query;
    for (const details of root.querySelectorAll('details')) {
      const key = details.dataset.filter, list = details.querySelector('[data-filter-choices]');
      const choices = key === 'tag' ? [...tagChoices] : sprintFilterChoices(cards, key), known = new Set(choices.map(([id]) => id));
      for (const id of filters[key]) if (!known.has(id)) choices.push([id, key === 'tag' ? `${id} (not in this Sprint)` : id === 'none' ? 'Unassigned (not in this Sprint)' : `${key} #${id} (not in this Sprint)`]);
      // Do not remove the focused checkbox during its change event. Keep absent
      // choices removable/reselectable until the open dropdown is dismissed.
      if (details.open) for (const input of list.querySelectorAll('input')) {
        if (!choices.some(([id]) => id === input.value)) choices.push([input.value, input.parentElement.textContent]);
      }
      const signature = JSON.stringify(choices.map(([id, name]) => [id, name, key === 'project' ? projectColor(projects, id) : '']));
      if (list.dataset.choices !== signature) {
        list.replaceChildren(...choices.map(([id, name]) => {
          const label = document.createElement('label'), input = document.createElement('input');
          input.type = 'checkbox'; input.value = id;
          label.append(input);
          if (key === 'project') label.append(projectSwatch(projectColor(projects, id)));
          label.append(document.createTextNode(name)); return label;
        }));
        if (!choices.length) { const empty = document.createElement('span'); empty.textContent = 'No choices in this Sprint'; list.append(empty); }
        list.dataset.choices = signature;
      }
      for (const input of list.querySelectorAll('input')) input.checked = filters[key].includes(input.value);
      const selected = filters[key].map(id => choices.find(([value]) => value === id)?.[1] || id);
      const label = key[0].toUpperCase() + key.slice(1);
      const summary = details.querySelector('summary');
      summary.textContent = `${label}: ${selected.length === 1 ? selected[0] : selected.length ? `${selected.length} selected` : 'All'}`;
      summary.title = `${label}: ${selected.length ? selected.join(', ') : 'All'}`;
      details.classList.toggle('has-selection', selected.length > 0);
      details.querySelector('[data-clear-filter]').hidden = !selected.length;
      if (details.open) positionOptions(details);
    }
    root.querySelector('[data-sprint-count]').textContent = `Showing ${visible.length} of ${cards.length} Cards`;
    const active = sprintFiltersActive(filters);
    const noMatches = active && visible.length === 0;
    root.querySelector('[data-clear-sprint]').hidden = !active;
    root.querySelector('[data-sprint-count]').hidden = noMatches;
    root.querySelector('[data-sprint-empty]').hidden = !noMatches;
  };
}
