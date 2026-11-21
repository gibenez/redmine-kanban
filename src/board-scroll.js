// One current-board snapshot per tab, never a history of visited boards.
const storageKey = 'redmine-sprint-board.scroll';
const statusLists = host => [...host.querySelectorAll('[data-id^="status-"] > .kanban-drag')];
const finite = value => Number.isFinite(value) ? value : 0;

export function createBoardScroll(host) {
  let scope = null, saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Optional session state. */ }

  function capture() {
    return { x: host.scrollLeft, columns: statusLists(host).map(list => {
      const top = list.getBoundingClientRect().top;
      const card = list.scrollTop > 0 && [...list.querySelectorAll('.kanban-item')].find(node => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > top && rect.top < top + list.clientHeight;
      });
      return { id: list.parentElement.dataset.id, y: list.scrollTop,
        anchor: card ? { id: card.dataset.eid, offset: card.getBoundingClientRect().top - top } : null };
    }) };
  }
  function save() {
    if (scope === null) return;
    saved = { scope, position: capture() };
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Keep in-memory preservation. */ }
  }
  function reset() {
    scope = null; saved = null;
    host.scrollLeft = 0;
    for (const list of statusLists(host)) list.scrollTop = 0;
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional session state. */ }
  }
  function beforeRender(nextScope) {
    if (scope === nextScope) return capture();
    scope = nextScope;
    return saved?.scope === scope ? saved.position : null;
  }
  function afterRender(position) {
    host.scrollLeft = Math.max(0, finite(position?.x));
    const lists = statusLists(host);
    let sharedY;
    for (const list of lists) {
      const column = Array.isArray(position?.columns) && position.columns.find(column => column?.id === list.parentElement.dataset.id);
      const card = column?.anchor && [...list.querySelectorAll('.kanban-item')].find(node => node.dataset.eid === column.anchor.id);
      const y = card ? list.scrollTop + card.getBoundingClientRect().top - list.getBoundingClientRect().top - finite(column.anchor.offset) : finite(column?.y);
      list.scrollTop = Math.max(0, y);
      if (list.classList.contains('has-swimlanes') && (sharedY === undefined || card)) sharedY = list.scrollTop;
    }
    // Swimlane rows share a single vertical position, even when the anchor only
    // exists in one status Column. Flat Columns keep independent positions.
    if (sharedY !== undefined) for (const list of lists) if (list.classList.contains('has-swimlanes')) list.scrollTop = sharedY;
    save();
  }
  return { beforeRender, afterRender, save, reset };
}
