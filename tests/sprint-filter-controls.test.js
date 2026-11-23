import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSprintFilterControls } from '../src/sprint-filter-controls.js';
import { emptySprintFilters } from '../src/sprint-filters.js';

const html = readFileSync('index.html', 'utf8');
beforeEach(() => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
});

describe('readable planning controls', () => {
  it('labels both search scopes visibly and provides a keyboard skip link', () => {
    for (const id of ['sprint-query', 'query']) {
      const field = document.getElementById(id);
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label.textContent).toMatch(id === 'query' ? /Backlog/ : /Sprint/);
      expect(field.getAttribute('aria-label')).toMatch(id === 'query' ? /backlog/i : /Sprint/);
    }
    expect(document.body.firstElementChild.matches('a.skip-link[href="#main"]')).toBe(true);
    expect(document.getElementById('main').tabIndex).toBe(-1);
  });

  it('marks selected filters, keeps the input node and removes emphasis when cleared', () => {
    const root = document.getElementById('sprint-filters');
    const filters = emptySprintFilters();
    const cards = [{ id: 1, project: { id: 2, name: 'Module' }, priority: { id: 3, name: 'High' } }];
    const changed = vi.fn(() => render(filters, cards, cards));
    const render = createSprintFilterControls(root, changed);
    render(filters, cards, cards);
    const search = root.querySelector('input[type="search"]');
    const project = root.querySelector('[data-filter="project"]');
    expect(project.classList.contains('has-selection')).toBe(false);
    const checkbox = project.querySelector('input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(filters.project).toEqual(['2']);
    expect(project.classList.contains('has-selection')).toBe(true);
    expect(project.querySelector('summary').textContent).toBe('Project: Module');
    expect(project.querySelector('input')).toBe(checkbox);
    expect(root.querySelector('input[type="search"]')).toBe(search);
    root.querySelector('[data-clear-sprint]').click();
    expect(project.classList.contains('has-selection')).toBe(false);
    expect(project.querySelector('summary').textContent).toBe('Project: All');
    expect(document.activeElement).toBe(search);
  });

  it('sorts projects like the overview: valid colors first, then natural alphabetical names', () => {
    const root = document.getElementById('sprint-filters');
    const render = createSprintFilterControls(root, vi.fn());
    const projects = [
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Zulu', custom_fields: [{ name: 'Colore', value: '#123456' }] },
      { id: 3, name: 'Module 10', custom_fields: [{ name: 'Colore', value: '#abcdef' }] },
      { id: 4, name: 'Module 2', custom_fields: [{ name: 'Colore', value: '#ABCDEF' }] },
      { id: 5, name: 'Beta', custom_fields: [{ name: 'Colore', value: 'invalid' }] },
      { id: 6, name: 'Gamma', custom_fields: [{ name: 'Colore', value: '' }] },
    ];
    const cards = projects.map(project => ({ project }));
    render(emptySprintFilters(), cards, cards, [], projects);
    const labels = () => [...root.querySelectorAll('[data-filter="project"] label')].map(node => node.textContent);
    expect(labels()).toEqual(['Module 2', 'Module 10', 'Zulu', 'Alpha', 'Beta', 'Gamma']);
    render(emptySprintFilters(), cards, cards, [], []);
    expect(labels()).toEqual(['Alpha', 'Beta', 'Gamma', 'Module 2', 'Module 10', 'Zulu']);
  });

  it('adds project-only swatches and updates colors without changing filter labels', () => {
    const root = document.getElementById('sprint-filters');
    const render = createSprintFilterControls(root, vi.fn());
    const filters = emptySprintFilters();
    const cards = [{ project: { id: 2, name: 'Module' }, priority: { id: 3, name: 'High' } }];
    const projects = [{ id: 2, custom_fields: [{ name: 'Colore', value: '#123456' }] }];
    render(filters, cards, cards, [], projects);
    const label = root.querySelector('[data-filter="project"] label');
    expect(label.textContent).toBe('Module');
    expect(label.querySelector('.project-swatch').style.getPropertyValue('--project-color')).toBe('#123456');
    expect(root.querySelector('[data-filter="priority"] .project-swatch')).toBeNull();
    render(filters, cards, cards, [], []);
    expect(root.querySelector('[data-filter="project"] .project-swatch').style.getPropertyValue('--project-color')).toBe('');
  });

  it('names a single selection and describes multiple or unavailable selections', () => {
    const root = document.getElementById('sprint-filters');
    const filters = emptySprintFilters();
    const cards = [
      { project: { id: 2, name: 'Module' }, priority: { id: 3, name: 'High' } },
      { project: { id: 4, name: 'Another module' }, priority: { id: 5, name: 'Low' } },
    ];
    const render = createSprintFilterControls(root, vi.fn());
    const project = root.querySelector('[data-filter="project"] summary');
    filters.project = ['2', '4'];
    render(filters, cards, cards);
    expect(project.textContent).toBe('Project: 2 selected');
    expect(project.title).toBe('Project: Module, Another module');
    filters.project = ['999'];
    render(filters, cards, []);
    expect(project.textContent).toBe('Project: project #999 (not in this Sprint)');
    expect(root.querySelector('[data-sprint-empty]').hidden).toBe(false);
    expect(root.querySelector('[data-sprint-count]').hidden).toBe(true);
    expect(root.querySelector('[data-clear-sprint]').hidden).toBe(false);
  });

  it('clears only the chosen dropdown and returns focus to its summary', () => {
    const root = document.getElementById('sprint-filters');
    const filters = { ...emptySprintFilters(), query: 'Login', project: ['2'], assignee: ['none'], priority: ['3'], tag: ['release'] };
    const cards = [{ project: { id: 2, name: 'Module' }, priority: { id: 3, name: 'High' } }];
    const render = createSprintFilterControls(root, () => render(filters, cards, cards));
    render(filters, cards, cards);
    const project = root.querySelector('[data-filter="project"]');
    project.open = true;
    project.querySelector('[data-clear-filter]').click();
    expect(filters).toEqual({ query: 'Login', project: [], assignee: ['none'], priority: ['3'], tag: ['release'] });
    expect(project.open).toBe(false);
    expect(project.querySelector('[data-clear-filter]').hidden).toBe(true);
    expect(document.activeElement).toBe(project.querySelector('summary'));
    expect(root.querySelector('[data-clear-sprint]').hidden).toBe(false);
    root.querySelector('[data-filter="priority"]').open = true;
    root.querySelector('[data-clear-sprint]').click();
    expect(filters).toEqual(emptySprintFilters());
    expect(root.querySelectorAll('details[open]')).toHaveLength(0);
    expect(root.querySelector('[data-sprint-count]').hidden).toBe(false);
  });

  it('opens above its anchor when there is insufficient room below', () => {
    const root = document.getElementById('sprint-filters');
    createSprintFilterControls(root, vi.fn())(emptySprintFilters(), [], []);
    const project = root.querySelector('[data-filter="project"]');
    const panel = project.querySelector('.sprint-filter-options');
    project.getBoundingClientRect = () => ({ left: innerWidth - 20, right: innerWidth, top: innerHeight - 68, bottom: innerHeight - 38 });
    Object.defineProperties(panel, { offsetWidth: { value: 240 }, offsetHeight: { value: 140 }, scrollHeight: { value: 140 } });
    project.querySelector('summary').click();
    expect(project.open).toBe(true);
    expect(parseFloat(panel.style.top)).toBe(innerHeight - 68 - 140 - 4);
    expect(parseFloat(panel.style.left)).toBe(innerWidth - 240 - 8);
  });

  it('dismisses a panel when horizontal scrolling moves its anchor out of view', () => {
    const root = document.getElementById('sprint-filters');
    createSprintFilterControls(root, vi.fn())(emptySprintFilters(), [], []);
    const controls = root.querySelector('[data-sprint-controls]');
    const project = root.querySelector('[data-filter="project"]');
    controls.getBoundingClientRect = () => ({ left: 8, right: 300 });
    project.getBoundingClientRect = () => ({ left: 350, right: 450, top: 100, bottom: 130 });
    project.open = true;
    controls.dispatchEvent(new Event('scroll'));
    expect(project.open).toBe(false);
  });
});
