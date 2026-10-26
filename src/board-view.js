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
    const existing = new Map([...list.querySelectorAll('.kanban-item')].map(node => [node.dataset.eid, node]));
    const ids = new Set(definition.item.map(item => item.id));
    for (const [id, node] of existing) if (!ids.has(id)) node.remove();
    const targets = new Map();
    if (definition.lanes) {
      const wantedLanes = new Set(definition.lanes.map(lane => lane.id));
      for (const section of list.querySelectorAll('.swimlane-section')) if (!wantedLanes.has(section.dataset.lane)) section.remove();
      let nextSection = list.firstElementChild;
      for (const lane of definition.lanes) {
        let section = [...list.children].find(node => node.classList.contains('swimlane-section') && node.dataset.lane === lane.id);
        if (!section) {
          section = document.createElement('section'); section.className = 'swimlane-section'; section.dataset.lane = lane.id;
          const heading = document.createElement('div'); heading.className = 'swimlane-heading';
          const cards = document.createElement('div'); cards.className = 'swimlane-cards';
          section.append(heading, cards); list.append(section);
        }
        if (section !== nextSection) list.insertBefore(section, nextSection);
        nextSection = section.nextElementSibling;
        // jKanban expects each drop list's parent to identify its status Column.
        section.dataset.id = definition.id;
        patchMarkup(section.firstElementChild, lane.title, renderedHeadings);
        targets.set(lane.id, section.lastElementChild);
      }
      list.classList.add('has-swimlanes');
    } else {
      for (const [id, node] of existing) if (ids.has(id) && node.parentElement !== list) list.append(node);
      list.querySelectorAll('.swimlane-section').forEach(section => section.remove());
      list.classList.remove('has-swimlanes');
    }
    const cursors = new Map();
    for (const item of definition.item) {
      const target = definition.lanes ? targets.get(item.lane) : list;
      if (!cursors.has(target)) cursors.set(target, target.firstElementChild);
      const nextCard = cursors.get(target);
      let node = existing.get(item.id);
      if (!node) {
        board.addElement(definition.id, item);
        node = list.lastElementChild;
      }
      if (node !== nextCard) target.insertBefore(node, nextCard);
      cursors.set(target, node.nextElementSibling);
      const classes = ['kanban-item', ...item.class].join(' ');
      if (node.className !== classes) node.className = classes;
      patchMarkup(node, item.title, renderedCards);
    }
  }
  // jKanban retains Column definitions for drag permissions; Dragula retains a list
  // of drop targets. Only Card lists, not Swimlane headings, are drop targets.
  board.options.boards = definitions;
  board.boardContainer.splice(0, board.boardContainer.length, ...[...board.container.children].flatMap(column => {
    const list = column.querySelector('.kanban-drag');
    return list.classList.contains('has-swimlanes') ? [...list.querySelectorAll('.swimlane-cards')] : [list];
  }));
  alignSwimlanes(board.container);
}

export function alignSwimlanes(container) {
  const rows = new Map();
  for (const section of container.querySelectorAll('.swimlane-section')) {
    section.firstElementChild.style.minHeight = '';
    section.lastElementChild.style.minHeight = '';
    const row = rows.get(section.dataset.lane) || [];
    row.push(section); rows.set(section.dataset.lane, row);
  }
  for (const row of rows.values()) {
    const headingHeight = Math.max(...row.map(section => section.firstElementChild.getBoundingClientRect().height));
    const cardsHeight = Math.max(64, ...row.map(section => section.lastElementChild.getBoundingClientRect().height));
    for (const section of row) {
      section.firstElementChild.style.minHeight = `${headingHeight}px`;
      section.lastElementChild.style.minHeight = `${cardsHeight}px`;
    }
  }
}
