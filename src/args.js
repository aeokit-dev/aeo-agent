export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const positional = [];
  const flags = {};

  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const [key, inline] = token.slice(2).split('=', 2);
    const value = inline ?? (rest[index + 1] && !rest[index + 1].startsWith('--') ? rest[++index] : true);
    if (flags[key] === undefined) flags[key] = value;
    else flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value];
  }

  return { command, positional, flags };
}

export function numberFlag(flags, name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const value = Number(flags[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

export function listFlag(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}
