import { ConfirmDialog, PageHeader, TagChip, Toggle } from '@project-graphite/ui';
import { useState } from 'react';
import { LazyTerminal } from '../components/LazyTerminal';

export function HostShell({ owner }: { owner: boolean }) {
  const [root, setRoot] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        actions={owner && <Toggle checked={root} label="Root shell" onChange={(on) => (on ? setAsking(true) : setRoot(false))} />}
        title="VPS shell"
      >
        <span className="flex flex-wrap items-center gap-2">
          <TagChip color={root ? 'red' : 'blue'} label={root ? 'root' : 'operator'} />
          <TagChip color="gray" label={root ? 'guarded, every command logged' : 'read-only docker, every command logged'} />
        </span>
      </PageHeader>
      <LazyTerminal key={root ? 'root' : 'operator'} path={root ? '/ws/host?mode=root' : '/ws/host'} />
      {asking && (
        <ConfirmDialog
          confirmLabel="Open the root shell"
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            setRoot(true);
            setAsking(false);
          }}
          title="Open a root shell on the VPS?"
          tone="danger"
        >
          Every command runs as root on production. The guard blocks commands that would take down the VPS or the console and asks before destructive ones, but it is a guard rail, not a sandbox. Every command is logged with your login.
        </ConfirmDialog>
      )}
    </div>
  );
}
