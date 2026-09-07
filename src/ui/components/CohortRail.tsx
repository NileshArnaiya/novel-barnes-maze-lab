import { triageOrder } from '../../core/quality';
import type { VideoRecord } from '../../core/types';

/**
 * The cohort list, ordered by who needs a human.
 *
 * A student with sixty videos should not watch sixty videos. The sort puts
 * flagged trials first and clean ones last, so the review queue is the list
 * itself rather than something the user has to construct by hand. This is where
 * most of the time saving in the tool actually comes from.
 */
export function CohortRail({
  videos,
  activeId,
  onSelect,
  onClearExamples,
}: {
  videos: readonly VideoRecord[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClearExamples?: () => void;
}) {
  // Example trials are generated data. Once real trials are loaded, mixing the
  // two in one list invites someone to export a spreadsheet with three
  // synthetic rows in it, so they are separated and can be removed.
  const real = videos.filter((v) => !v.synthetic);
  const examples = videos.filter((v) => v.synthetic);
  const ordered = triageOrder(real);
  const flagged = ordered.filter((v) => v.qcFlag).length;

  const row = (v: VideoRecord) => {
    const edited = (v.summary?.humanEditedFrames ?? 0) > 0;
    return (
          <button
            key={v.id}
            className={`video-row${v.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(v.id)}
            aria-current={v.id === activeId}
          >
            <div className="name">{v.animalId}</div>
            <div className="meta">
              {v.fileName}
              {v.day !== null ? ` · day ${v.day}` : ''}
            </div>
            <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {v.qcFlag ? (
                <span className="badge warn">needs review</span>
              ) : v.summary ? (
                <span className="badge ok">scored</span>
              ) : null}
              {edited ? <span className="badge edited">edited</span> : null}
              {v.summary ? (
                <span className="badge ok">{v.summary.strategy.label}</span>
              ) : null}
            </div>
          </button>
    );
  };

  return (
    <div>
      {real.length > 0 ? (
        <>
          <h3>
            {real.length} trial{real.length === 1 ? '' : 's'}
            {flagged > 0 ? ` · ${flagged} need a look` : ''}
          </h3>
          {ordered.map(row)}
        </>
      ) : null}

      {examples.length > 0 ? (
        <>
          <h3 style={{ marginTop: real.length > 0 ? 18 : 0 }}>
            {real.length > 0 ? 'Example trials (generated)' : 'Example trials'}
          </h3>
          {examples.map(row)}
          {real.length > 0 && onClearExamples ? (
            <button
              className="ghost"
              style={{ fontSize: 13, marginTop: 6, width: '100%' }}
              onClick={onClearExamples}
            >
              Remove examples
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
