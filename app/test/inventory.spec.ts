import { describe, expect, it } from 'vitest';
import { projects, type ContainerView } from '../src/server/inventory.ts';
import { parseOpen } from '../src/server/proxy.ts';

function container(project: string, service: string, state: string, sleeps = false, usage?: { cpu: number; memory: number }): ContainerView {
  return {
    id: `${project}-${service}`,
    name: `${project}-${service}-1`,
    project,
    service,
    image: 'image',
    imageId: `sha256:${service}`,
    state,
    status: '',
    health: null,
    created: 0,
    ports: [],
    networks: {},
    sleeps,
    cpu: usage?.cpu ?? null,
    memory: usage?.memory ?? null,
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

  it('totals running usage and storage per project', () => {
    const [strata] = projects(
      [
        container('strata', 'app', 'running', false, { cpu: 2, memory: 100 }),
        container('strata', 'postgres', 'running', false, { cpu: 1, memory: 50 }),
        container('strata', 'backup', 'exited'),
      ],
      {
        images: 0,
        containers: 0,
        buildCache: 0,
        imageSizes: { 'sha256:app': 300, 'sha256:postgres': 200 },
        volumes: [
          { name: 'strata_postgres-data', project: 'strata', size: 40, inUse: true },
          { name: 'other_data', project: 'other', size: 999, inUse: true },
          { name: 'strata_unmeasured', project: 'strata', size: -1, inUse: false },
        ],
      },
    );
    expect([strata.cpu, strata.memory, strata.storage]).toEqual([3, 150, { volumes: 40, images: 500 }]);
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
