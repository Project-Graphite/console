import { ErrorState, PageHeader } from '@project-graphite/ui';
import { bytes, type Disk } from '../api';
import { usePoll } from '../usePoll';

export function Volumes() {
  const { data, error } = usePoll<Disk>('/api/disk', 60_000);
  if (error && !data) {
    return <ErrorState title="The console could not list volumes">{error.message}</ErrorState>;
  }
  const volumes = [...(data?.volumes ?? [])].sort((a, b) => b.size - a.size);
  return (
    <div className="space-y-6">
      <PageHeader title="Volumes">
        <span className="mono-sm text-muted">{bytes(volumes.reduce((sum, volume) => sum + Math.max(0, volume.size), 0))} in total</span>
      </PageHeader>
      <div className="stat-card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>volume</th>
              <th>project</th>
              <th>size</th>
              <th>in use</th>
            </tr>
          </thead>
          <tbody>
            {volumes.map((volume) => (
              <tr key={volume.name}>
                <td className="mono-sm break-all">{volume.name}</td>
                <td className="text-muted">{volume.project ?? '—'}</td>
                <td className="mono-sm whitespace-nowrap">{volume.size >= 0 ? bytes(volume.size) : '—'}</td>
                <td className="text-muted">{volume.inUse ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
