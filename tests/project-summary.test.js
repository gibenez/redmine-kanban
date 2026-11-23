import { describe, expect, it } from 'vitest';
import { projectSummary, renderProjectSummary } from '../src/project-summary.js';

const projects = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Zulu', custom_fields: [{ name: 'Colore', value: '#AABBCC' }] },
  { id: 3, name: 'Beta', custom_fields: [{ name: 'Colore', value: 'red' }] },
];
const card = (project, version) => ({ project: projects[project - 1], fixed_version: version });

describe('project Target Version overview', () => {
  it('groups by project ID, deduplicates version IDs and puts valid-colored projects first', () => {
    const result = projectSummary([
      card(1), card(2, { id: 10, name: '2.10' }), card(2, { id: 9, name: '2.9' }),
      card(2, { id: 9, name: '2.9' }), card(2), card(3),
    ], projects);
    expect(result.map(group => group.name)).toEqual(['Zulu', 'Alpha', 'Beta']);
    expect(result[0].versions).toEqual(['2.9', '2.10', 'none']);
    expect(result[0].color).toBe('#aabbcc');
    expect(result[2].color).toBe('');
  });

  it('does not merge projects or versions that share names but have different IDs', () => {
    const result = projectSummary([
      { project: { id: 1, name: 'Same' }, fixed_version: { id: 1, name: 'Release' } },
      { project: { id: 1, name: 'Same' }, fixed_version: { id: 2, name: 'Release' } },
      { project: { id: 2, name: 'Same' } },
    ], []);
    expect(result).toHaveLength(2);
    expect(result[0].versions).toEqual(['Release', 'Release']);
  });

  it('renders safe inline text, preserves unchanged entries and clears stale data', () => {
    const root = document.createElement('section');
    const cards = [{ project: { id: 1, name: '<img src=x>' }, fixed_version: { id: 1, name: '<script>' } }, card(2)];
    renderProjectSummary(root, cards, projects);
    expect(root.textContent).toBe('Zulu (none)<img src=x> (<script>)');
    expect(root.querySelectorAll('img, script')).toHaveLength(0);
    expect(root.querySelectorAll('.project-summary-entry')).toHaveLength(2);
    const first = root.firstChild;
    renderProjectSummary(root, cards, projects);
    expect(root.firstChild).toBe(first);
    expect(root.querySelector('.project-swatch').style.getPropertyValue('--project-color')).toBe('#aabbcc');
    renderProjectSummary(root, [], projects);
    expect(root.textContent).toBe('No projects in this Sprint');
    expect(root.querySelector('.project-summary-entry')).toBeNull();
  });
});
