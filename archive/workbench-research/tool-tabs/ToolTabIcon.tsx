export function ToolTabIcon({ directory = false }: { directory?: boolean }) {
  return <svg className="tool-tab-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
    {directory ? <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> : <><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" /></>}
  </svg>;
}
