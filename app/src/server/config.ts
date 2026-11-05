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
  dev: devLogin ? { login: devLogin, owner: process.env.DEV_ROLE !== 'member' } : undefined,
  github: devLogin ? undefined : { clientId: required('GITHUB_CLIENT_ID'), clientSecret: required('GITHUB_CLIENT_SECRET') },
  access: production ? { team: required('ACCESS_TEAM'), audience: required('ACCESS_AUD') } : undefined,
  organisation: process.env.GITHUB_ORG ?? 'Project-Graphite',
  alertsToken: process.env.ALERTS_TOKEN || undefined,
  alertsRepo: process.env.ALERTS_REPO ?? 'project-graphite/platform',
  smtpUrl: process.env.SMTP_URL || undefined,
  alertsEmail: process.env.ALERTS_EMAIL || undefined,
  alertsFrom: process.env.ALERTS_FROM || undefined,
  docsRepo: process.env.DOCS_REPO ?? 'project-graphite/docs',
  dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  hostRoot: process.env.HOST_ROOT ?? '/proc/1/root',
  dataDir: process.env.DATA_DIR ?? '/data',
  logsDir: process.env.LOGS_DIR ?? '/logs',
  logsKeepDays: Number(process.env.LOGS_KEEP_DAYS ?? 7),
  sablierUrl: process.env.SABLIER_URL ?? 'http://sablier:10000',
  self: process.env.HOSTNAME ?? '',
  sshTarget: process.env.SSH_TARGET ?? 'ubuntu@localhost',
  secretsKey: process.env.SECRETS_KEY || undefined,
  graphiteHome: process.env.GRAPHITE_HOME ?? '/srv/graphite',
  platformRepo: process.env.PLATFORM_REPO ?? 'project-graphite/platform',
  platformApp:
    process.env.PLATFORM_APP_CLIENT_ID && process.env.PLATFORM_APP_PRIVATE_KEY
      ? { clientId: process.env.PLATFORM_APP_CLIENT_ID, privateKey: process.env.PLATFORM_APP_PRIVATE_KEY.replaceAll('\\n', '\n') }
      : undefined,
  webRoot: new URL('../web/', import.meta.url),
};
