import { ConfirmDialog, ErrorState, PageHeader, timeAgo } from '@project-graphite/ui';
import { useState } from 'react';
import { bytes, post, type Disk, type Image } from '../api';
import { usePoll } from '../usePoll';

export function Images() {
  const images = usePoll<Image[]>('/api/images', 30_000);
  const disk = usePoll<Disk>('/api/disk', 30_000);
  const [pruning, setPruning] = useState(false);
  const [reclaimed, setReclaimed] = useState<number>();

  if (images.error && !images.data) {
    return <ErrorState title="The console could not list images">{images.error.message}</ErrorState>;
  }

  const unused = (images.data ?? []).filter((image) => image.usedBy.length === 0);
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <button className="secondary-button" onClick={() => setPruning(true)} type="button">
            Remove dangling images
          </button>
        }
        title="Images"
      >
        {disk.data && (
          <span className="mono-sm text-muted">
            images {bytes(disk.data.images)} · containers {bytes(disk.data.containers)} · build cache {bytes(disk.data.buildCache)}
            {reclaimed !== undefined && ` · reclaimed ${bytes(reclaimed)}`}
          </span>
        )}
      </PageHeader>
      <div className="stat-card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>image</th>
              <th>size</th>
              <th>created</th>
              <th>used by</th>
            </tr>
          </thead>
          <tbody>
            {(images.data ?? []).map((image) => (
              <tr key={image.id}>
                <td className="mono-sm break-all">{image.tags.join(', ') || image.id.slice(7, 19)}</td>
                <td className="mono-sm">{bytes(image.size)}</td>
                <td className="text-muted">{timeAgo(new Date(image.created).toISOString())}</td>
                <td className="mono-sm text-muted">{image.usedBy.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono-sm text-faint">{unused.length} images are not used by any container.</p>
      {pruning && (
        <ConfirmDialog
          confirmLabel="Remove"
          onClose={() => setPruning(false)}
          onConfirm={async () => {
            const result = await post<{ reclaimed: number }>('/api/prune');
            setReclaimed(result.reclaimed);
            await images.reload();
          }}
          title="Remove dangling images?"
        >
          Removes untagged image layers no container uses. Tagged images stay.
        </ConfirmDialog>
      )}
    </div>
  );
}
