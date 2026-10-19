import { Button, ConfirmDialog, ErrorState, PageHeader, timeAgo } from '@project-graphite/ui';
import { useState } from 'react';
import { bytes, can, type Disk, type Image, post, shortImage, type User } from '../api';
import { usePoll } from '../usePoll';

export function Images({ user }: { user: User }) {
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
          can(user, 'area:images') && (
            <Button onClick={() => setPruning(true)}>Remove dangling images</Button>
          )
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
                <td className="mono-sm break-all" title={image.tags.join(', ')}>{image.tags.map(shortImage).join(', ') || image.id.slice(7, 19)}</td>
                <td className="mono-sm whitespace-nowrap">{bytes(image.size)}</td>
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
