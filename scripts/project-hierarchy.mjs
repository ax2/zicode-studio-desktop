export function loadMissingParents(issues, parents, readNodes) {
  const missing = issues.filter(issue => !parents.has(issue.node_id));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const ids = missing.slice(offset, offset + 100).map(issue => issue.node_id);
    for (const node of readNodes(ids)) {
      if (node?.id) parents.set(node.id, node.parent);
    }
  }
}

/** Audit the repository snapshot, including closed issues and items removed from the Project. */
export function summarizeHierarchy(issues, parents, repository, versionMilestone) {
  const byId = new Map(issues.map(issue => [issue.node_id, issue]));
  const roots = [], rootsWithoutEpic = [], rootsWithoutVersionMilestone = [];
  const unavailable = [], unresolvedParents = [], externalParents = [];
  const edges = new Map();
  let withParent = 0;
  for (const issue of issues) {
    const entry = {
      number: issue.number, title: issue.title, state: issue.state,
      url: issue.html_url, milestone: issue.milestone?.title ?? null,
    };
    const parent = parents.get(issue.node_id);
    if (parent === undefined) {
      unavailable.push(entry);
    } else if (parent === null) {
      roots.push(entry);
      if (!issue.labels.some(label => label.name === "type:epic")) rootsWithoutEpic.push(entry);
      if (!versionMilestone.test(entry.milestone ?? "")) rootsWithoutVersionMilestone.push(entry);
    } else {
      withParent++;
      if (byId.has(parent.id)) {
        edges.set(issue.number, parent.number);
      } else {
        const relation = {...entry, parent:parent.url};
        if (parent.repository.nameWithOwner.toLowerCase() === repository.toLowerCase()) unresolvedParents.push(relation);
        else externalParents.push(relation);
      }
    }
  }
  const cycles = [], visited = new Set();
  for (const start of edges.keys()) {
    const chain = [], positions = new Map();
    let number = start;
    while (edges.has(number) && !visited.has(number)) {
      if (positions.has(number)) {
        cycles.push(chain.slice(positions.get(number)));
        break;
      }
      positions.set(number, chain.length);
      chain.push(number);
      number = edges.get(number);
    }
    for (const member of chain) visited.add(member);
  }
  return {
    total: issues.length, withParent, roots, rootsWithoutEpic, rootsWithoutVersionMilestone,
    unavailable, unresolvedParents, externalParents, cycles,
  };
}
