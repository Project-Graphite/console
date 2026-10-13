import { lazy, Suspense } from 'react';

const Terminal = lazy(() => import('./Terminal').then((module) => ({ default: module.Terminal })));

export function LazyTerminal({ path }: { path: string }) {
  return (
    <Suspense fallback={<div className="terminal-frame h-[32rem]" />}>
      <Terminal path={path} />
    </Suspense>
  );
}
