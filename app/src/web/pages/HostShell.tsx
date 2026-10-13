import { PageHeader } from '@project-graphite/ui';
import { LazyTerminal } from '../components/LazyTerminal';

export function HostShell() {
  return (
    <div className="space-y-4">
      <PageHeader title="VPS shell">
        <span className="mono-sm text-muted">a root shell on the host; every command runs on production</span>
      </PageHeader>
      <LazyTerminal path="/ws/host" />
    </div>
  );
}
