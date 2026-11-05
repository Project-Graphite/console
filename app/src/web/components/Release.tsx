import { ConfirmDialog, Select, TagChip } from '@project-graphite/ui';
import { useState } from 'react';
import { post, type Release as ReleaseData } from '../api';
import { usePoll } from '../usePoll';
import { ActionButton } from './ActionButton';
import { Switch } from './Switch';

const day = (at: string) => new Date(at).toISOString().slice(0, 16).replace('T', ' ');

export function Release({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const { data, error, reload } = usePoll<ReleaseData>(`/api/projects/${slug}/release`, 60_000);
  const [tag, setTag] = useState('');
  const [disabling, setDisabling] = useState(false);
  const chosen = tag || data?.current || '';
  const refresh = () => {
    void reload();
    onChanged();
  };
  const enable = (on: boolean) => post(`/api/projects/${slug}/enabled`, { enabled: on }).then(refresh);
  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mono-sm text-muted">Release</h2>
        {data && <TagChip color={data.enabled ? 'green' : 'gray'} label={data.enabled ? 'enabled' : 'disabled'} />}
        {data?.current && <TagChip color="blue" label={data.current} />}
        {data && (
          <span className="ml-auto">
            <Switch checked={data.enabled} label="Enabled" onChange={(on) => (on ? void enable(true) : setDisabling(true))} />
          </span>
        )}
      </div>
      {error && <p className="mono-sm text-faint">{error.message}</p>}
      {data && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-96 max-w-full">
            <Select
              label="Version"
              onChange={setTag}
              options={data.history.map((entry) => ({
                value: entry.tag,
                label: `${entry.tag}${entry.tag === data.current ? ' · running' : ''}`,
                hint: `${day(entry.at)} UTC · ${entry.by}`,
              }))}
              searchable
              value={chosen}
            />
          </div>
          <span className="ml-auto">
            <ActionButton
              disabled={!data.enabled || !chosen || chosen === data.current}
              labels={{ idle: 'Deploy this version', busy: 'Committing…', done: 'Deploying', failed: 'Retry' }}
              run={() => post(`/api/projects/${slug}/release`, { tag: chosen }).then(refresh)}
              variant="primary"
            />
          </span>
        </div>
      )}
      {disabling && (
        <ConfirmDialog
          confirmLabel="Disable"
          onClose={() => setDisabling(false)}
          onConfirm={() => enable(false).then(() => setDisabling(false))}
          title={`Disable ${slug}?`}
          tone="danger"
        >
          Platform takes the project down on its next deploy, about a minute from now. Its volumes stay; enabling it deploys the current version again.
        </ConfirmDialog>
      )}
    </section>
  );
}
