import { describe, expect, it } from 'vitest';
import { projects, type ContainerView } from '../src/server/inventory.ts';
import { parseOpen } from '../src/server/proxy.ts';

function container(project: string, service: string, state: string, sleeps = false): ContainerView {
  return {
    id: `${project}-${service}`,
    name: `${project}-${service}-1`,
    project,
    service,
    image: 'image',
    state,
    status: '',
    health: null,
    created: 0,
    ports: [],
    networks: {},
    sleeps,
    cpu: null,
    memory: null,
    memoryLimit: null,
  };
}

describe('projects', () => {
  it('groups containers by project and marks a sleeping project asleep only when all of it is stopped', () => {
    const grouped = projects([
      container('message-lab', 'web', 'exited', true),
      container('message-lab', 'postgres', 'exited', true),
      container('strata', 'app', 'running'),
    ]);
    expect(grouped.map((project) => [project.slug, project.asleep])).toEqual([
      ['message-lab', true],
      ['strata', false],
    ]);
    expect(grouped[0].containers.map((member) => member.service)).toEqual(['postgres', 'web']);
  });
});

describe('parseOpen', () => {
  it('reads the container, port and remaining path', () => {
    expect(parseOpen('/open/0123456789ab/9001/browser/files')).toEqual({ container: '0123456789ab', port: 9001, path: '/browser/files' });
    expect(parseOpen('/open/0123456789ab/80')).toEqual({ container: '0123456789ab', port: 80, path: '/' });
  });

  it('refuses anything that is not a container id and a port', () => {
    expect(parseOpen('/open/../etc/80')).toBeUndefined();
    expect(parseOpen('/open/0123456789ab/notaport/')).toBeUndefined();
  });
});
