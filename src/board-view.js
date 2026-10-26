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
        // Each Column reserves the row height; one shared heading spans all statuses.
        section.firstElementChild.setAttribute('aria-hidden', 'true');
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
  const host = board.container.parentElement;
  let headers = host.querySelector(':scope > .swimlane-headers');
  const lanes = definitions.find(column => column.lanes)?.lanes;
  if (lanes?.length) {
    if (!headers) {
      headers = document.createElement('div'); headers.className = 'swimlane-headers'; host.append(headers);
    }
    const wanted = new Set(lanes.map(lane => lane.id));
    for (const heading of [...headers.children]) if (!wanted.has(heading.dataset.lane)) heading.remove();
    let nextHeading = headers.firstElementChild;
    for (const lane of lanes) {
      let heading = [...headers.children].find(node => node.dataset.lane === lane.id);
      if (!heading) {
        heading = document.createElement('div'); heading.className = 'swimlane-heading'; heading.dataset.lane = lane.id;
      }
      patchMarkup(heading, lane.title, renderedHeadings);
      if (heading !== nextHeading) headers.insertBefore(heading, nextHeading);
      nextHeading = heading.nextElementSibling;
    }
  } else headers?.remove();
  alignSwimlanes(board.container);
}

export function positionSwimlaneHeaders(container) {
  const host = container.parentElement, headers = host.querySelector(':scope > .swimlane-headers');
  if (!headers) return;
  const lists = [...container.querySelectorAll('.has-swimlanes')];
  if (!lists.length) return;
  const hostRect = host.getBoundingClientRect(), first = lists[0].getBoundingClientRect(), last = lists.at(-1).getBoundingClientRect();
  headers.style.left = `${first.left - hostRect.left + host.scrollLeft}px`;
  headers.style.top = `${first.top - hostRect.top + host.scrollTop}px`;
  // Overlay scrollbars (notably macOS) consume no clientWidth space. Always
  // leave a 16px clear strip; use the actual gutter when a wider native scrollbar
  // is present. Measuring only clientWidth lets the overlay paint over the thumb.
  const lastList = lists.at(-1);
  const scrollbarGutter = Math.max(16, last.width - lastList.clientLeft - lastList.clientWidth);
  headers.style.width = `${last.right - first.left - scrollbarGutter}px`;
  headers.style.height = `${first.height}px`;
  const sections = [...lists[0].querySelectorAll('.swimlane-section')];
  for (const heading of headers.children) {
    const section = sections.find(node => node.dataset.lane === heading.dataset.lane);
    if (section) heading.style.top = `${section.getBoundingClientRect().top - first.top}px`;
  }
}

export function alignSwimlanes(container) {
  positionSwimlaneHeaders(container);
  const headers = container.parentElement.querySelector(':scope > .swimlane-headers');
  const rows = new Map();
  for (const section of container.querySelectorAll('.swimlane-section')) {
    section.firstElementChild.style.minHeight = '';
    section.lastElementChild.style.minHeight = '';
    const row = rows.get(section.dataset.lane) || [];
    row.push(section); rows.set(section.dataset.lane, row);
  }
  for (const [id, row] of rows) {
    const heading = headers && [...headers.children].find(node => node.dataset.lane === id);
    const headingHeight = heading ? heading.getBoundingClientRect().height : 0;
    const cardsHeight = Math.max(64, ...row.map(section => section.lastElementChild.getBoundingClientRect().height));
    for (const section of row) {
      section.firstElementChild.style.minHeight = `${headingHeight}px`;
      section.lastElementChild.style.minHeight = `${cardsHeight}px`;
    }
  }
  positionSwimlaneHeaders(container);
}
