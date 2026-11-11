// Separate keys keep a save in one project/tab from replacing another project's Sprint.
export function createSelectionPreferences(server, userId, storage = () => localStorage) {
  const prefix = `redmine-sprint-board.selection:${JSON.stringify([server.replace(/\/+$/, ''), String(userId)])}:`;
  const memory = new Map();
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
  function read(key) {
    try {
      const value = storage().getItem(prefix + key);
      if (validId(value)) { memory.set(key, String(value)); return String(value); }
    } catch { /* Optional view preference; retain this tab's selections. */ }
    return memory.get(key) || null;
  }
  function write(key, value) {
    if (!validId(value)) return;
    memory.set(key, String(value));
    try { storage().setItem(prefix + key, String(value)); } catch { /* Optional view preference. */ }
  }
  return {
    project: () => read('project'),
    sprint: projectId => read(`sprint:${projectId}`),
    selectProject: projectId => write('project', projectId),
    selectSprint: (projectId, sprintId) => write(`sprint:${projectId}`, sprintId),
  };
}
