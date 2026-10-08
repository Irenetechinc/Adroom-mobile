import { spawn } from 'child_process';

const TALON_CLEANER = [
  'import json, re, sys',
  'payload = json.load(sys.stdin)',
  'from talon import quotations',
  'content = payload.get("text") or payload.get("html") or ""',
  'kind = "text/plain" if payload.get("text") else "text/html"',
  'cleaned = quotations.extract_from(content[:1000000], kind)',
  'cleaned = re.sub(r"\\r\\n?", "\\n", cleaned or "").strip()',
  'markers = [r"(?im)^--\\s*$", r"(?im)^sent from my .+$", r"(?im)^get outlook for .+$", r"(?im)^sent from outlook for .+$"]',
  'lines = cleaned.splitlines()',
  'for i, line in enumerate(lines):',
  '    if any(re.match(marker, line.strip()) for marker in markers):',
  '        lines = lines[:i]',
  '        break',
  'cleaned = "\\n".join(lines).strip()',
  'if cleaned:',
  '    tail = cleaned.splitlines()',
  '    signoffs = re.compile(r"(?i)^(best|best regards|kind regards|regards|sincerely|yours|cheers|thanks|thank you)[,! .]*$")',
  '    for i in range(max(1, len(tail) - 5), len(tail)):',
  '        if signoffs.match(tail[i].strip()):',
  '            tail = tail[:i]',
  '            break',
  '    cleaned = "\\n".join(tail).strip()',
  'print(json.dumps({"text": cleaned}))',
].join('\n');

export async function cleanReplyWithTalon(text: string, html: string): Promise<string> {
  const payload = JSON.stringify({ text: text.slice(0, 1000000), html: html.slice(0, 1000000) });
  const python = process.env.TALON_PYTHON || 'python3';
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'C.UTF-8',
      PYTHONPATH: process.env.PYTHONPATH,
      PYTHONUSERBASE: process.env.PYTHONUSERBASE,
      LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    };
    const child = spawn(python, ['-c', TALON_CLEANER], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env,
    });
    let stdout = '';
    let settled = false;
    const finishError = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Talon reply cleaning failed.'));
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finishError();
    }, 12000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 150000) {
        child.kill('SIGKILL');
        finishError();
      }
    });
    child.on('error', finishError);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code !== 0) return reject(new Error('Talon reply cleaning failed.'));
      try {
        const result = JSON.parse(stdout);
        resolve(String(result?.text || '').trim());
      } catch {
        reject(new Error('Talon reply cleaning returned invalid output.'));
      }
    });
    child.stdin.end(payload);
  });
}
