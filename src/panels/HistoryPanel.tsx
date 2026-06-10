// History panel — every generated graphic / import / caption, with a thumbnail,
// a filter bar, live search, and per-card actions (Add to timeline, Use prompt,
// Delete). Slides over the editor, like the extension's History.
import { useMemo, useState } from 'react';
import { thumbUrl } from '../api';
import { relTime, type HistoryEntry } from '../history';

const KIND_LABEL: Record<string, string> = { generate: 'AI', import: 'Import', caption: 'Captions' };
const FILTERS: { val: string; label: string }[] = [
  { val: 'all', label: 'All' },
  { val: 'generate', label: 'Renders' },
  { val: 'import', label: 'Imports' },
  { val: 'caption', label: 'Captions' },
];

export const HistoryPanel: React.FC<{
  history: HistoryEntry[];
  onClose: () => void;
  onAdd: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
  onUsePrompt?: (prompt: string) => void;
}> = ({ history, onClose, onAdd, onDelete, onUsePrompt }) => {
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false;
      if (q && !((e.prompt || '').toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [history, kind, query]);

  return (
    <div className="settings-panel show">
      <div className="settings-header">
        <span>History</span>
        <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="hist-toolbar">
        <div className="hist-filter">
          {FILTERS.map((f) => (
            <button key={f.val} className={kind === f.val ? 'active' : ''} onClick={() => setKind(f.val)}>{f.label}</button>
          ))}
        </div>
        <div className="hist-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} placeholder="Search history — prompt or filename" />
          {query && <button className="hist-search-clear" onClick={() => setQuery('')} aria-label="Clear">✕</button>}
        </div>
      </div>

      <div className="settings-body">
        {history.length === 0 && <div className="hist-empty">No renders yet. Generate a graphic or import a video to see it here.</div>}
        {history.length > 0 && shown.length === 0 && <div className="hist-empty">No matches.</div>}
        <div className="hist-grid">
          {shown.map((e) => (
            <div className="hist-card" key={e.id}>
              <div className="hist-thumb">
                <img src={thumbUrl(e.id)} alt="" loading="lazy" onError={(ev) => ((ev.target as HTMLImageElement).style.opacity = '0')} />
                <span className={'hist-badge ' + e.kind}>{KIND_LABEL[e.kind] || e.kind}</span>
              </div>
              <div className="hist-meta">
                <div className="hist-name" title={e.prompt || e.name}>{e.prompt || e.name}</div>
                <div className="hist-sub">{e.width}×{e.height} · {(e.durationFrames / e.fps).toFixed(1)}s · {relTime(e.t)}</div>
              </div>
              <div className="hist-actions">
                <button onClick={() => onAdd(e)}>+ Timeline</button>
                {e.kind === 'generate' && e.prompt && onUsePrompt && <button onClick={() => onUsePrompt(e.prompt!)}>Use prompt</button>}
                <button className="danger" onClick={() => onDelete(e)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
