// History panel — every generated graphic / import / caption, with a thumbnail
// and actions (Add to timeline, Delete). Slides over the editor, like the
// extension's History.
import { thumbUrl } from '../api';
import { relTime, type HistoryEntry } from '../history';

const KIND_LABEL: Record<string, string> = { generate: 'AI', import: 'Import', caption: 'Captions' };

export const HistoryPanel: React.FC<{
  history: HistoryEntry[];
  onClose: () => void;
  onAdd: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
}> = ({ history, onClose, onAdd, onDelete }) => {
  return (
    <div className="settings-panel show">
      <div className="settings-header">
        <span>History</span>
        <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="settings-body">
        {history.length === 0 && <div className="hist-empty">No renders yet. Generate a graphic or import a video to see it here.</div>}
        <div className="hist-grid">
          {history.map((e) => (
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
                <button className="danger" onClick={() => onDelete(e)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
