// Project colours are presentation-only: never inherit from a parent project or
// accept arbitrary CSS from Redmine custom fields.
export function projectColor(projects, projectId) {
  const project = projects.find(project => String(project.id) === String(projectId));
  const value = project?.custom_fields?.find(field => field.name === 'Colore')?.value;
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : '';
}
