import { AppShell, type ShellNavItem, type ShellTab } from '@project-graphite/ui';
import { useEffect, useState } from 'react';
import { get, Unauthorized, type User } from './api';
import { ContainerPage } from './pages/ContainerPage';
import { Docs } from './pages/Docs';
import { HostShell } from './pages/HostShell';
import { Images } from './pages/Images';
import { Overview } from './pages/Overview';
import { ProjectPage } from './pages/ProjectPage';
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
  if (user.owner && hash === '/images') return <Images />;
  if (user.owner && hash === '/volumes') return <Volumes />;
  if (user.owner && hash === '/shell') return <HostShell />;
  return <Overview />;
}

export function App() {
  const hash = useHash();
  const [user, setUser] = useState<User>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    get<User>('/api/me').then(setUser, (reason: Error) => {
      if (reason instanceof Unauthorized) {
        location.assign('/auth/login');
      } else {
        setError(reason.message);
      }
    });
  }, []);

  const pages: ShellTab[] = [
    { href: '#/', label: 'Overview', icon: 'home', active: !/^\/(images|volumes|shell|docs)/.test(hash) },
    ...(user?.owner
      ? ([
          { href: '#/images', label: 'Images', icon: 'library', active: hash === '/images' },
          { href: '#/volumes', label: 'Volumes', icon: 'folder', active: hash === '/volumes' },
          { href: '#/shell', label: 'Shell', icon: 'monitor', active: hash === '/shell' },
        ] satisfies ShellTab[])
      : []),
    { href: '#/docs', label: 'Docs', icon: 'file', active: hash.startsWith('/docs') },
  ];
  const nav: ShellNavItem[] = pages.map(({ href, label, active }) => ({ href, label, active }));

  return (
    <AppShell
      actions={
        user && (
          <span className="flex items-center gap-3">
            <span className="mono-sm text-muted">
              {user.login} · {user.owner ? 'owner' : 'contributor'}
            </span>
            <a className="mono-sm rule-link" href="/auth/logout">
              sign out
            </a>
          </span>
        )
      }
      brand={{ href: '#/', mark: <GraphiteMark />, name: 'Graphite Console' }}
      nav={nav}
      tabs={pages}
    >
      <main className="shell py-6" id="content">
        {error && <p className="error-message">{error}</p>}
        {user && <Page hash={hash} user={user} />}
      </main>
    </AppShell>
  );
}
