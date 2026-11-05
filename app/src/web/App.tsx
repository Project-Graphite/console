import Alert from '@mui/material/Alert';
import MuiLink from '@mui/material/Link';
import { AppShell, type ShellNavItem, type ShellTab } from '@project-graphite/ui';
import { useEffect, useState } from 'react';
import { can, get, Unauthorized, type AlertsData, type User } from './api';
import { usePoll } from './usePoll';
import { Admin } from './pages/Admin';
import { Alerts } from './pages/Alerts';
import { Backups } from './pages/Backups';
import { ContainerPage } from './pages/ContainerPage';
import { Docs } from './pages/Docs';
import { HostShell } from './pages/HostShell';
import { Images } from './pages/Images';
import { LogSearch } from './pages/LogSearch';
import { Overview } from './pages/Overview';
import { ProjectPage } from './pages/ProjectPage';
import { SecretPage, Secrets } from './pages/Secrets';
import { Volumes } from './pages/Volumes';

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const update = () => setHash(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return hash;
}

function GraphiteMark() {
  return (
    <svg aria-hidden="true" className="h-[1.15em] w-[0.9em] shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={6} viewBox="-3 -3 36 46">
      <path d="M5.62 25 L0 40 M24.38 25 L30 40" />
      <path d="M15 0 L8.25 18 H21.75 Z" fill="currentColor" />
    </svg>
  );
}

function Page({ hash, user }: { hash: string; user: User }) {
  const container = /^\/container\/([0-9a-f]{12,64})$/.exec(hash);
  if (container) return <ContainerPage id={container[1]} user={user} />;
  const project = /^\/project\/([a-z0-9-]+)$/.exec(hash);
  if (project) return <ProjectPage key={project[1]} slug={project[1]} user={user} />;
  const docs = /^\/docs(?:\/(.+))?$/.exec(hash);
  if (docs) return <Docs path={docs[1] ?? ''} />;
  const secret = /^\/secrets\/([a-z0-9-]+)\/([A-Z_][A-Z0-9_]*)(?:\/(history|usage))?$/.exec(hash);
  if (secret && can(user, `secrets:${secret[1]}`)) return <SecretPage key={hash} name={secret[2]} project={secret[1]} tab={secret[3] ?? ''} user={user} />;
  if (user.owner && hash === '/secrets') return <Secrets />;
  if (user.owner && hash === '/backups') return <Backups />;
  if (hash === '/images') return <Images user={user} />;
  if (hash === '/volumes') return <Volumes />;
  if (hash === '/alerts') return <Alerts owner={user.owner} />;
  if (hash === '/logs') return <LogSearch />;
  if (can(user, 'area:shell') && hash === '/shell') return <HostShell />;
  if (user.owner && hash === '/admin') return <Admin />;
  return <Overview />;
}

export function App() {
  const hash = useHash();
  const [user, setUser] = useState<User>();
  const [error, setError] = useState<string>();
  const alerts = usePoll<AlertsData>('/api/alerts', 60_000).data?.active.length ?? 0;

  useEffect(() => {
    get<User>('/api/me').then(setUser, (reason: Error) => {
      if (!(reason instanceof Unauthorized)) {
        setError(reason.message);
      }
    });
  }, []);

  const pages: ShellTab[] = [
    { href: '#/', label: 'Overview', icon: 'home', active: !/^\/(images|volumes|alerts|logs|shell|admin|docs|secrets|backups)/.test(hash) },
    { href: '#/alerts', label: alerts ? `Alerts · ${alerts}` : 'Alerts', icon: 'bell', active: hash === '/alerts' },
    { href: '#/logs', label: 'Logs', icon: 'search', active: hash === '/logs' },
    { href: '#/images', label: 'Images', icon: 'library', active: hash === '/images' },
    { href: '#/volumes', label: 'Volumes', icon: 'folder', active: hash === '/volumes' },
    ...(user && can(user, 'area:shell') ? ([{ href: '#/shell', label: 'Shell', icon: 'monitor', active: hash === '/shell' }] satisfies ShellTab[]) : []),
    ...(user?.owner
      ? ([
          { href: '#/secrets', label: 'Secrets', icon: 'lock', active: hash.startsWith('/secrets') },
          { href: '#/backups', label: 'Backups', icon: 'download', active: hash === '/backups' },
          { href: '#/admin', label: 'Admin', icon: 'key', active: hash === '/admin' },
        ] satisfies ShellTab[])
      : []),
    { href: '#/docs', label: 'Docs', icon: 'file', active: hash.startsWith('/docs') },
  ];
  const nav: ShellNavItem[] = pages.map(({ href, label, active }) => ({ href, label, active }));

  return (
    <AppShell
      actions={
        user && (
          <span className="flex items-center gap-3 whitespace-nowrap">
            <span className="mono-sm hidden text-muted sm:inline">
              {user.login} · {user.owner ? 'owner' : 'member'}
            </span>
            <MuiLink className="mono-sm" href="/auth/logout" underline="always">
              sign out
            </MuiLink>
          </span>
        )
      }
      brand={{ href: '#/', mark: <GraphiteMark />, name: 'Graphite Console' }}
      nav={nav}
      tabs={pages}
    >
      <main className="shell py-6" id="content">
        {error && <Alert severity="error">{error}</Alert>}
        {user && <Page hash={hash} user={user} />}
      </main>
    </AppShell>
  );
}
