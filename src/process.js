import { spawn, spawnSync } from 'node:child_process';

export function commandExists(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

export function execute(command, args, { cwd, input = '', timeout = 300_000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let buffer = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, new Error(`${command} timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!onLine) return;
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line, 'stdout');
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line, 'stderr');
    });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      if (buffer.trim()) onLine?.(buffer, 'stdout');
      if (code === 0) finish(resolve, { stdout: stdout.trim(), stderr: stderr.trim() });
      else finish(reject, new Error(`${command} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
    child.stdin.end(input);
  });
}
