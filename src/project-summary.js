import { projectColor } from './project-colors.js';

const compareNames = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function compareProjectPresentation(a, b) {
  return Number(Boolean(b.color)) - Number(Boolean(a.color)) || compareNames(a.name, b.name) || compareNames(a.id, b.id);
}

// Input is the complete ordinary Sprint Card set, never the filtered view.
export function projectSummary(cards, projects) {
  const groups = new Map();
  for (const card of cards) {
    if (card.project?.id == null) continue;
    const id = String(card.project.id);
    if (!groups.has(id)) groups.set(id, {
      id, name: card.project.name || projects.find(project => String(project.id) === id)?.name || `Project #${id}`,
      color: projectColor(projects, id), versions: new Map(),
    });
    const group = groups.get(id), version = card.fixed_version;
    group.versions.set(version?.id == null ? 'none' : String(version.id), version?.id == null ? 'none' : version.name || `Version #${version.id}`);
  }
  return [...groups.values()]
    .sort(compareProjectPresentation)
    .map(group => ({ ...group, versions: [...group.versions.entries()]
      .sort(([a, nameA], [b, nameB]) => Number(a === 'none') - Number(b === 'none') || compareNames(nameA, nameB) || compareNames(a, b))
      .map(([, name]) => name) }));
}

export function projectSwatch(color) {
  const swatch = document.createElement('span');
  swatch.className = 'project-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  if (color) swatch.style.setProperty('--project-color', color);
  return swatch;
}

export function renderProjectSummary(root, cards, projects) {
  const groups = projectSummary(cards, projects);
  const signature = JSON.stringify(groups);
  if (root.dataset.summary === signature) return;
  root.replaceChildren(...groups.map(group => {
    const entry = document.createElement('span');
    entry.className = 'project-summary-entry';
    entry.append(projectSwatch(group.color), document.createTextNode(`${group.name} (${group.versions.join(', ')})`));
    return entry;
  }));
  if (!groups.length) root.textContent = 'No projects in this Sprint';
  root.dataset.summary = signature;
}
