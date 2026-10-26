export const children = (element, tag) => (element?.children ?? []).filter(child => child.tag === tag);
export const referenceOf = element => children(element, 'p:NodeReference')[0];
export const choicesOf = element => children(referenceOf(element), 'Choice');
export const isDefinition = element => choicesOf(element).some(c => /Definition$/.test(c.attrs.Kind));
export const isRegion = element => choicesOf(element).some(c => /Region/.test(c.attrs.Kind));
export function labelOf(element) {
  if (element.attrs.Name) return element.attrs.Name;
  if (element.tag === 'Pad') return element.attrs.Value || element.attrs.Comment || 'Pad';
  const choices = choicesOf(element);
  return choices.at(-1)?.attrs.Name || element.tag;
}
export function boundsOf(element) {
  const values = (element.attrs.Bounds || '').split(',').map(Number);
  return { x: Number.isFinite(values[0]) ? values[0] : 0, y: Number.isFinite(values[1]) ? values[1] : 0,
    w: Number.isFinite(values[2]) && values[2]>0 ? values[2] : 0,
    h: Number.isFinite(values[3]) && values[3]>0 ? values[3] : 0 };
}
export function indexDocument(document) {
  const byId = new Map(), parent = new Map(), definitions = [], all = [];
  function visit(element, owner) {
    parent.set(element, owner); all.push(element);
    if (element.attrs.Id && !byId.has(element.attrs.Id)) byId.set(element.attrs.Id, element);
    if (element.tag === 'Node' && isDefinition(element)) {
      definitions.push({ id: element.attrs.Id, name: labelOf(element), kind: choicesOf(element)[0]?.attrs.Name || 'Definition', element });
    }
    for (const child of element.children) visit(child, element);
  }
  visit(document.tree, null);
  return { ...document, key: `${document.path}::${document.documentId}`, byId, parent, definitions, all };
}

export function buildScene(model, scopeId, operationId = '') {
  const scope = model.byId.get(scopeId) || model.tree;
  const body = scope.tag === 'Node' ? children(scope, 'Patch')[0] : scope;
  const nodes = [], controls = [], rawLinks = [], ports = [], overlays = [];
  const operations = children(body, 'Patch').filter(p => p.attrs.Name).map(element => ({id: element.attrs.Id, name: element.attrs.Name, element}));
  const selectedOperation = operations.find(p => p.id === operationId);
  const explicitParticipants = new Set((selectedOperation?.element.attrs.ParticipatingElements || '').split(',').filter(Boolean));
  function collect(container, depth = 0, ownerOperation = null) {
    if (!container) return;
    for (const element of container.children) {
      const { tag, attrs } = element;
      if (tag === 'Canvas') collect(element, depth, ownerOperation);
      if (tag === 'Node' || tag === 'Pad') {
        const b = boundsOf(element), region = tag === 'Node' && isRegion(element);
        const label = labelOf(element);
        const w = b.w || Math.max(Math.min(210, 20 + label.length * 6.4), region ? 96 : 68);
        nodes.push({id: attrs.Id, element, label, ...b, w, h: b.h || (region ? 64 : 26), depth, region,
          definition: isDefinition(element), pad: tag === 'Pad'});
        if (region) for (const patch of children(element, 'Patch')) collect(patch, depth + 1);
      }
      if (tag === 'ControlPoint') controls.push({id: attrs.Id, element, ...boundsOf(element)});
      if (tag === 'Link') rawLinks.push(element);
      if (tag === 'Overlay') overlays.push({id: attrs.Id, element, ...boundsOf(element)});
      if (tag === 'Pin') ports.push({element, operation: ownerOperation});
      if (tag === 'Patch') {
        // Operation lenses expose relevant boundary pins, but never discard shared nodes.
        const topOperation = operations.find(op => op.element === element);
        if (!topOperation || !operationId || topOperation.id === operationId) collect(element, depth, topOperation || {name: element.attrs.Name || 'Region'});
      }
    }
  }
  collect(body);
  const anchors = new Map();
  for (const c of controls) anchors.set(c.id, {x:c.x, y:c.y, element:c.element, control:true});
  for (const n of nodes) {
    const pins = children(n.element, 'Pin');
    for (const direction of ['Input', 'Output']) {
      const set = pins.filter(p => (p.attrs.Kind || '').includes(direction));
      set.forEach((pin, index) => anchors.set(pin.attrs.Id, {
        x:n.x + n.w * (index + 1) / (set.length + 1), y:n.y + (direction === 'Output' ? n.h : 0),
        element:pin, owner:n.id, state:(pin.attrs.Kind || '').startsWith('State'), direction,
      }));
    }
    if (n.pad) anchors.set(n.id, {x:n.x+n.w/2,y:n.y+n.h,element:n.element,owner:n.id});
  }
  const boundaryPorts = [];
  for (const {element, operation} of ports) {
    const id = element.attrs.Id;
    const adjacent = rawLinks.filter(l => (l.attrs.Ids || '').split(',').includes(id))
      .flatMap(l => l.attrs.Ids.split(',')).find(other => other !== id && anchors.has(other));
    const anchor = anchors.get(adjacent);
    // Unwired operations remain inspectable in the operation list without filling the canvas.
    if (!anchor) continue;
    const input = (element.attrs.Kind || '').includes('Input');
    const x = anchor.x, y = anchor.y + (input ? -34 : 34);
    const port = { id, element, x, y, label:element.attrs.Name || 'Pin', operation:operation?.name || '', input };
    anchors.set(id, {...port, boundary:true}); boundaryPorts.push(port);
  }
  const links = [], unplacedLinks = [];
  for (const element of rawLinks) {
    const ids = (element.attrs.Ids || '').split(',').filter(Boolean);
    const points = ids.map(id => anchors.get(id));
    if (points.length < 2 || points.some(p => !p)) { unplacedLinks.push(element); continue; }
    links.push({ id:element.attrs.Id, element, ids, points,
      hidden:element.attrs.IsHidden === 'true', feedback:element.attrs.IsFeedback === 'true',
      state:points.some(p => p.state), });
  }
  const connected = new Set();
  if (selectedOperation) {
    const queue = ports.filter(p => p.operation?.id === operationId).map(p => p.element.attrs.Id);
    for (const id of explicitParticipants) {
      connected.add(id);
      for (const pin of children(model.byId.get(id),'Pin')) queue.push(pin.attrs.Id);
    }
    while (queue.length) {
      const id = queue.pop();
      if (connected.has(id)) continue;
      connected.add(id);
      if (anchors.get(id)?.owner) connected.add(anchors.get(id).owner);
      for (const link of links) if (link.ids.includes(id)) for (const other of link.ids) if (!connected.has(other)) queue.push(other);
    }
  }
  const points = [...[...nodes,...overlays].flatMap(n=>[{x:n.x,y:n.y},{x:n.x+n.w,y:n.y+n.h}]), ...controls, ...boundaryPorts];
  const minX = points.length ? Math.min(...points.map(p=>p.x)) : 0;
  const minY = points.length ? Math.min(...points.map(p=>p.y)) : 0;
  const maxX = points.length ? Math.max(...points.map(p=>p.x)) : 200;
  const maxY = points.length ? Math.max(...points.map(p=>p.y)) : 200;
  return {scope,body,nodes,controls,links,boundaryPorts,overlays,anchors,operations,explicitParticipants,connected,unplacedLinks,
    bounds:{x:minX-50,y:minY-50,w:maxX-minX+100,h:maxY-minY+100}};
}

export function resolveReference(reference, documents) {
  const name = (reference?.attrs.LastDependency || reference?.attrs.LastSymbolSource || '').replaceAll('\\','/').split('/').at(-1);
  return name ? documents.filter(d => d.path.split('/').at(-1) === name) : [];
}
