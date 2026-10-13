import { UiProvider, type UiLinkProps } from '@project-graphite/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const Link = ({ href, ...props }: UiLinkProps) => <a href={href} {...props} />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiProvider link={Link}>
      <App />
    </UiProvider>
  </StrictMode>,
);
