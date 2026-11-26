export function summarizePlanningFields(issues, items, repository) {
  const required = ["Status", "优先级", "模块", "阶段", "负责会话"];
  const missingFields = [];
  for (const item of items) {
    if (item.__typename !== "Issue" || item.archived || item.state !== "OPEN" ||
        item.repository?.nameWithOwner?.toLowerCase() !== repository.toLowerCase()) continue;
    const fields = required.filter(name => !item.fields[name]?.trim());
    if (fields.length) missingFields.push({ number: item.number, url: item.url, fields });
  }
  const issuesWithoutType = issues.filter(issue => !issue.labels.some(({name}) => /^type:.+/.test(name)))
    .map(({number, html_url: url}) => ({number, url}));
  return { missingFields, issuesWithoutType };
}
