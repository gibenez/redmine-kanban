// Reconcile within each Column: an issue may legitimately appear in both Backlog and
// a closed Sprint. Never key Cards globally or replace the board to apply a Filter.
const renderedCards = new WeakMap();
const renderedHeadings = new WeakMap();

function patchChildren(target, source) {
  for (let index = 0; index < source.childNodes.length; index++) {
    const next = source.childNodes[index], current = target.childNodes[index];
    if (!current) { target.append(next.cloneNode(true)); continue; }
    if (current.isEqualNode(next)) continue;
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current.replaceWith(next.cloneNode(true)); continue;
    }
    if (current.nodeType === Node.TEXT_NODE) { current.textContent = next.textContent; continue; }
    for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    for (const attribute of next.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    patchChildren(current, next);
  }
  while (target.childNodes.length > source.childNodes.length) target.lastChild.remove();
}

function patchMarkup(target, markup, cache) {
  if (cache.get(target) === markup) return;
  const source = document.createElement('div'); source.innerHTML = markup;
  patchChildren(target, source);
  cache.set(target, markup);
}

export function reconcileBoard(board, definitions) {
  const wanted = new Set(definitions.map(column => column.id));
  for (const column of [...board.container.children]) {
    if (!wanted.has(column.dataset.id)) board.removeBoard(column.dataset.id);
  }
  let nextColumn = board.container.firstElementChild;
  for (const definition of definitions) {
    if (!board.findBoard(definition.id)) board.addBoards([{ ...definition, item: [] }]);
    const column = board.findBoard(definition.id);
    if (column !== nextColumn) board.container.insertBefore(column, nextColumn);
    nextColumn = column.nextElementSibling;
    patchMarkup(column.querySelector('.kanban-title-board'), definition.title, renderedHeadings);
    const list = column.querySelector('.kanban-drag');
    const existing = new Map([...list.children].map(node => [node.dataset.eid, node]));
    const ids = new Set(definition.item.map(item => item.id));
    for (const [id, node] of existing) if (!ids.has(id)) node.remove();
    let nextCard = list.firstElementChild;
    for (const item of definition.item) {
      let node = existing.get(item.id);
      if (!node) {
        board.addElement(definition.id, item);
        node = list.lastElementChild;
      }
      if (node !== nextCard) list.insertBefore(node, nextCard);
      nextCard = node.nextElementSibling;
      const classes = ['kanban-item', ...item.class].join(' ');
      if (node.className !== classes) node.className = classes;
      patchMarkup(node, item.title, renderedCards);
    }
  }
  // jKanban retains Column definitions for drag permissions; Dragula retains a list
  // of drop targets. Keep both in sync when an unmapped status Column comes/goes.
  board.options.boards = definitions;
  board.boardContainer.splice(0, board.boardContainer.length, ...[...board.container.children].map(column => column.querySelector('.kanban-drag')));
}
