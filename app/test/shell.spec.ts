import { describe, expect, it } from 'vitest';
import { classify, guardScript, sudoers } from '../src/server/shell.ts';

export const samples = {
  block: [
    'rm -rf /',
    'sudo rm -rf --no-preserve-root /',
    'rm -rf /etc',
    'rm -r /var/lib/docker/volumes',
    'mv /etc/graphite/console.env /tmp',
    'chmod 777 /srv/graphite/bin/graphite-up',
    'echo x > /etc/graphite/strata.env',
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    'reboot',
    'shutdown -h now',
    'systemctl stop docker',
    'systemctl disable graphite-agent.service',
    'docker stop console-app-1',
    'docker rm -f console-app-1',
    'docker compose -p console down',
    'docker volume rm console_data',
    'docker volume prune -f',
    'docker system prune -a --volumes',
    'docker network rm edge',
    ':(){ :|:& };:',
    'ufw disable',
    'iptables -F',
    'userdel amr',
    'passwd root',
    'chown -R nobody /',
    'trap - DEBUG',
    'bash',
    'bash --norc',
    'sudo -i',
    'su -',
    'sh -c "rm -rf /"',
  ],
  confirm: [
    'rm -rf node_modules',
    'rm -f /tmp/old.log',
    'docker rm strata-app-1',
    'docker restart strata-app-1',
    'docker image prune -a',
    'docker compose -p strata down',
    'systemctl restart nginx',
    'kill -9 1234',
    'apt-get purge nginx',
    'truncate -s 0 big.log',
    'chmod -R 755 site',
    'git reset --hard',
    'crontab -r',
    'echo a > /etc/hosts',
  ],
  allow: [
    'ls -la /etc/graphite',
    'docker ps',
    'docker logs --tail 50 strata-app-1',
    'df -h',
    'free -m',
    'cat /var/lib/docker/volumes/x',
    'grep -r error /srv/graphite/strata',
    'rm notes.txt',
    'echo reboot later',
    'systemctl status docker',
    'docker compose -p strata ps',
    'bash deploy.sh',
    'sh -c "echo hi"',
  ],
};

describe('classify', () => {
  it('blocks what would take down the VPS or the console', () => {
    expect(samples.block.filter((command) => classify(command) !== 'block')).toEqual([]);
  });

  it('asks before destructive commands', () => {
    expect(samples.confirm.filter((command) => classify(command) !== 'confirm')).toEqual([]);
  });

  it('lets everyday commands through', () => {
    expect(samples.allow.filter((command) => classify(command) !== 'allow')).toEqual([]);
  });
});

describe('guard', () => {
  it('traps every command, logs it and cannot be redefined', () => {
    const script = guardScript();
    expect(script).toContain('trap __graphite_guard DEBUG');
    expect(script).toContain('readonly -f __graphite_guard');
    expect(script).toContain('logger -t graphite-shell');
  });

  it('gives the operator read-only docker commands only', () => {
    expect(sudoers).toMatch(/^graphite-ops ALL=\(root\) NOPASSWD: /);
    expect(sudoers).not.toMatch(/docker (rm|stop|kill|exec|run|inspect|restart)/);
    expect(sudoers).toContain('/usr/bin/docker logs *');
  });
});
