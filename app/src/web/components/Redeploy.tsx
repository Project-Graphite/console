import { get, post } from '../api';
import { ActionButton } from './ActionButton';

interface Status {
  state: 'none' | 'running' | 'done' | 'failed';
  log: string;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function redeploy(project: string) {
  await post(`/api/projects/${project}/redeploy`);
  for (const deadline = Date.now() + 16 * 60_000; Date.now() < deadline; ) {
    await pause(3000);
    const status = await get<Status>(`/api/projects/${project}/redeploy`).catch(() => undefined);
    if (status?.state === 'done') {
      return;
    }
    if (status?.state === 'failed') {
      throw new Error(status.log.split('\n').slice(-8).join('\n') || 'The redeploy failed.');
    }
  }
  throw new Error('The redeploy did not finish within 16 minutes.');
}

export function Redeploy({ project, onDone }: { project: string; onDone: () => void }) {
  return (
    <ActionButton
      labels={{ idle: 'Redeploy', busy: 'Redeploying…', done: 'Redeployed', failed: 'Redeploy failed' }}
      run={() => redeploy(project).finally(onDone)}
    />
  );
}
