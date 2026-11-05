import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';
import { onHost } from './rollout.ts';

export type ShellMode = 'operator' | 'root';

export const operator = 'graphite-ops';
const guardPath = '/usr/local/share/graphite/shell-guard.bash';
const word = '(^|[;&|("\'`] *|(sudo|exec|nohup|time|env|xargs) +([^ ]+ +)*)';
const kept = '(etc/graphite|srv/graphite|var/lib/graphite|var/lib/docker)';
const end = '([ "\'`;&|)]|$)';

export const blocked = [
  String.raw`${word}rm +(-[A-Za-z-]+ +)*(/|/\*|/(bin|boot|etc|home|lib|lib64|opt|root|sbin|srv|usr|var)/?)${end}`,
  String.raw`${word}(rm|mv|shred|truncate|chmod|chown|chattr) +.*/${kept}(/|${end})`,
  String.raw`> */${kept}/`,
  String.raw`${word}(mkfs[.a-z0-9]*|wipefs|fdisk|sfdisk|parted|mkswap)${end}`,
  String.raw`${word}dd .*of=/dev/`,
  String.raw`> */dev/(sd|vd|xvd|nvme)`,
  String.raw`${word}(shutdown|reboot|halt|poweroff)${end}`,
  String.raw`${word}init +[06]${end}`,
  String.raw`${word}systemctl +(poweroff|reboot|halt|kexec|rescue|emergency)${end}`,
  String.raw`${word}systemctl +(stop|disable|mask|kill|restart) +(docker|containerd|graphite-agent|ssh|sshd)(\.service|\.socket)?${end}`,
  String.raw`${word}service +(docker|containerd|ssh|sshd) +(stop|restart)`,
  String.raw`${word}docker +(container +)?(rm|stop|kill|pause|restart|update|rename) +.*console`,
  String.raw`${word}docker +compose +.*console.* (down|stop|rm|kill|pause)${end}`,
  String.raw`${word}docker +volume +(rm +.*console_data|prune)`,
  String.raw`${word}docker +system +prune +.*(--volumes|-a|--all)`,
  String.raw`${word}docker +network +rm +.*edge`,
  String.raw`:\(\) *\{ *:\|: *& *\} *; *:`,
  String.raw`${word}ufw +(disable|reset)${end}`,
  String.raw`${word}iptables +.*(-F|--flush)`,
  String.raw`${word}nft +flush +ruleset`,
  String.raw`${word}(userdel|deluser) +`,
  String.raw`${word}passwd +root${end}`,
  String.raw`${word}(chmod|chown) +-R +[^ ]+ +/${end}`,
  String.raw`${word}trap${end}`,
  String.raw`${word}(bash|sh|dash|zsh|ksh|fish)( +-[-A-Za-z]+)*$`,
  String.raw`${word}(su${end}|sudo +(-i|-s|su|bash|sh)${end})`,
];

export const confirmed = [
  String.raw`${word}rm +.*-[A-Za-z]*[rRf]`,
  String.raw`${word}docker +(rm|stop|kill|restart|rmi|container +(rm|prune)|image +(rm|prune)|system +prune|network +rm|volume +rm)${end}`,
  String.raw`${word}docker +compose +.* (down|rm|stop|kill)${end}`,
  String.raw`${word}systemctl +(stop|restart|disable|mask) `,
  String.raw`${word}(kill|pkill|killall) `,
  String.raw`${word}(apt|apt-get|dpkg) +.*(remove|purge|autoremove)${end}`,
  String.raw`${word}(truncate|shred) `,
  String.raw`${word}(chmod|chown) +-R `,
  String.raw`${word}git +(reset +--hard|clean +-[a-z]*f)`,
  String.raw`${word}crontab +-r`,
  String.raw`> */etc/`,
];

const pattern = (list: string[]) => list.map((entry) => `(${entry})`).join('|');

export function classify(command: string) {
  return new RegExp(pattern(blocked)).test(command) ? 'block' : new RegExp(pattern(confirmed)).test(command) ? 'confirm' : 'allow';
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

export function guardScript() {
  return `[ -r /etc/profile ] && . /etc/profile
[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
GRAPHITE_BLOCK=${quote(pattern(blocked))}
GRAPHITE_CONFIRM=${quote(pattern(confirmed))}
readonly GRAPHITE_BLOCK GRAPHITE_CONFIRM GRAPHITE_LOGIN GRAPHITE_MODE
PS1='\\[\\e[2m\\]'"$GRAPHITE_MODE"'@\\h\\[\\e[0m\\]:\\w\\$ '
shopt -s extdebug
__graphite_guard() {
  [ -n "\${COMP_LINE-}" ] && return 0
  local command=$BASH_COMMAND answer
  case $command in __graphite_guard*) return 0 ;; esac
  if printf '%s' "$command" | grep -Eq -- "$GRAPHITE_BLOCK"; then
    logger -t graphite-shell -- "$GRAPHITE_LOGIN ($GRAPHITE_MODE) blocked: $command"
    printf '\\033[31mBlocked by the shell guard: this could take down the VPS or the console, or leave the guard. Use SSH if it is really needed.\\033[0m\\n' >&2
    return 1
  fi
  if printf '%s' "$command" | grep -Eq -- "$GRAPHITE_CONFIRM"; then
    printf '\\033[33mDestructive: %s\\nType yes to run it: \\033[0m' "$command" >&2
    read -r answer </dev/tty
    if [ "$answer" != yes ]; then
      logger -t graphite-shell -- "$GRAPHITE_LOGIN ($GRAPHITE_MODE) declined: $command"
      printf 'Not run.\\n' >&2
      return 1
    fi
  fi
  logger -t graphite-shell -- "$GRAPHITE_LOGIN ($GRAPHITE_MODE): $command"
  return 0
}
readonly -f __graphite_guard
trap __graphite_guard DEBUG
logger -t graphite-shell -- "$GRAPHITE_LOGIN opened a $GRAPHITE_MODE shell"
`;
}

const reads = ['ps', 'stats', 'logs', 'top', 'images', 'volume ls', 'network ls', 'compose ls', 'system df'];
export const sudoers = `${operator} ALL=(root) NOPASSWD: ${reads.flatMap((command) => [`/usr/bin/docker ${command}`, `/usr/bin/docker ${command} *`]).join(', ')}\n`;

let prepared: Promise<void> | undefined;

async function prepare() {
  const guard = path.join(config.hostRoot, guardPath);
  await mkdir(path.dirname(guard), { recursive: true });
  await writeFile(guard, guardScript());
  await chmod(guard, 0o644);
  const result = await onHost([
    'sh',
    '-c',
    `set -e
id ${operator} >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash ${operator}
printf '%s' ${quote(sudoers)} > /etc/sudoers.d/${operator}.new
chmod 440 /etc/sudoers.d/${operator}.new
visudo -cf /etc/sudoers.d/${operator}.new >/dev/null
mv /etc/sudoers.d/${operator}.new /etc/sudoers.d/${operator}`,
  ]);
  if (result.code !== 0) {
    throw new Error(`Preparing the host shell failed: ${result.output}`);
  }
}

export async function hostShell(mode: ShellMode, login: string) {
  prepared ??= prepare().catch((error: unknown) => {
    prepared = undefined;
    throw error;
  });
  await prepared;
  const shell = ['env', `GRAPHITE_LOGIN=${login}`, `GRAPHITE_MODE=${mode}`, 'TERM=xterm-256color', '/bin/bash', '--rcfile', guardPath, '-i'];
  return ['nsenter', '--target', '1', '--all', '--', ...(mode === 'root' ? shell : ['runuser', '-u', operator, '--', ...shell.slice(0, 3), `HOME=/home/${operator}`, ...shell.slice(3)])];
}
