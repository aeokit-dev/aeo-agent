import { execute } from './process.js';

export async function gitStatus(cwd) {
  try {
    const result = await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, timeout: 15_000 });
    return result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => {
      const file = line.slice(3).replace(/^"|"$/g, '');
      return file !== '.aeokit' && !file.startsWith('.aeokit/');
    });
  } catch {
    return [];
  }
}

export async function gitDiff(cwd) {
  try {
    const result = await execute('git', ['diff', '--binary', '--', '.', ':(exclude).aeokit'], { cwd, timeout: 30_000 });
    return result.stdout;
  } catch {
    return '';
  }
}
