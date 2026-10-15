export const levels = ['error', 'warning', 'debug', 'info'] as const;
export type Level = (typeof levels)[number];

export function levelOf(lower: string): Level {
  if (/\b(error|err|failed|failure|exception|fatal|panic|critical)\b/.test(lower)) return 'error';
  if (/\b(warn|warning|wrn|caution)\b/.test(lower)) return 'warning';
  if (/\b(debug|dbg|trace|verbose)\b/.test(lower)) return 'debug';
  return 'info';
}

export function segments(text: string, needle: string) {
  if (!needle) {
    return [{ text, match: false }];
  }
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let index = lower.indexOf(needle); index !== -1; index = lower.indexOf(needle, from)) {
    if (index > from) {
      parts.push({ text: text.slice(from, index), match: false });
    }
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    from = index + needle.length;
  }
  if (from < text.length) {
    parts.push({ text: text.slice(from), match: false });
  }
  return parts;
}

const clock = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatTime(time: string) {
  const parts = Object.fromEntries(clock.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function entryDetail(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
