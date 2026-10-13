const production = process.env.NODE_ENV === 'production';
const devLogin = production ? undefined : process.env.DEV_LOGIN;

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const config = {
  production,
  port: Number(process.env.PORT ?? 3000),
  appUrl: required('APP_URL'),
  sessionSecret: required('SESSION_SECRET'),
  dev: devLogin ? { login: devLogin, owner: process.env.DEV_ROLE !== 'contributor' } : undefined,
  github: devLogin ? undefined : { clientId: required('GITHUB_CLIENT_ID'), clientSecret: required('GITHUB_CLIENT_SECRET') },
  access: production ? { team: required('ACCESS_TEAM'), audience: required('ACCESS_AUD') } : undefined,
  organisation: process.env.GITHUB_ORG ?? 'Project-Graphite',
  registryUrl:
    process.env.REGISTRY_URL ??
    'https://raw.githubusercontent.com/project-graphite/graphite-hub/main/site/src/data/registry.json',
  dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  hostRoot: process.env.HOST_ROOT ?? '/proc/1/root',
  dataDir: process.env.DATA_DIR ?? '/data',
  sablierUrl: process.env.SABLIER_URL ?? 'http://sablier:10000',
  self: process.env.HOSTNAME ?? '',
  sshTarget: process.env.SSH_TARGET ?? 'ubuntu@localhost',
  webRoot: new URL('../web/', import.meta.url),
};
