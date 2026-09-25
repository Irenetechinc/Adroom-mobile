import assert from 'assert';
import { createServer, type Server } from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PublicProfileToolAdapters } from './publicProfileToolAdapters';

async function createFakeTool(): Promise<{ command: string; directory: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'public-profile-adapter-'));
  const script = path.join(directory, 'fake-tool.js');
  const command = path.join(directory, 'fake-tool');
  await fs.writeFile(script, `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const folderFlag = args.includes('--folderoutput') ? '--folderoutput' : '--output';
const outputIndex = args.indexOf(folderFlag);
const output = outputIndex >= 0 ? path.resolve(process.cwd(), args[outputIndex + 1]) : null;
if (!output) process.exit(2);
fs.mkdirSync(output, { recursive: true });
if (folderFlag === '--folderoutput') {
  fs.writeFileSync(path.join(output, 'report_public_ndjson.json'), [
    JSON.stringify({ site: 'Example', url_user: 'https://example.test/public-user', status: { status: 'claimed' }, username: 'public-user', bio: 'Public profile' }),
    JSON.stringify({ site: 'Example', url_user: 'https://example.test/public-user', status: { status: 'claimed' }, username: 'public-user', bio: 'Public profile' }),
    JSON.stringify({ site: 'Unsafe', url_user: 'https://unsafe.test/public-user', text: 'Contact email@example.com for details' })
  ].join('\\n'));
} else {
  fs.writeFileSync(path.join(output, 'public-user.json'), JSON.stringify({
    found: [{ platform: 'HelixExample', found: true, url: 'https://helix.test/public-user', bio: 'Public profile' }]
  }));
}
`, 'utf8');
  await fs.writeFile(command, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, 'utf8');
  await fs.chmod(command, 0o755);
  return { command, directory };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port');
  return address.port;
}

async function main(): Promise<void> {
  const fake = await createFakeTool();
  const adapters = new PublicProfileToolAdapters(fake.command);
  let deepkrakMethod = '';
  let deepkrakPath = '';
  const deepkrakServer = createServer((request, response) => {
    deepkrakMethod = request.method || '';
    deepkrakPath = request.url || '';
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      results: [{ platform: 'DeepExample', url: 'https://deep.test/public-user', text: 'Public result' }],
    }));
  });

  try {
    const rejected = await adapters.search('maigret_public_username', 'web', 'email@example.com');
    assert.strictEqual(rejected.attempted, false);
    assert.strictEqual(rejected.hits.length, 0);

    const maigret = await adapters.search('maigret_public_username', 'web', 'public-user');
    assert.strictEqual(maigret.available, true);
    assert.strictEqual(maigret.hits.length, 1, 'Maigret duplicate reports should be deduplicated');
    assert.ok(maigret.hits[0].url?.startsWith('https://example.test/'));
    assert.ok(!maigret.hits.some((hit) => hit.text.includes('email@example.com')));

    const helix = await adapters.search('helix_public_username', 'twitter', 'public-user');
    assert.strictEqual(helix.available, true);
    assert.strictEqual(helix.hits.length, 1);
    assert.strictEqual(helix.hits[0].platform, 'twitter');

    const port = await listen(deepkrakServer);
    const previousBaseUrl = process.env.DEEPKRAK3N_BASE_URL;
    process.env.DEEPKRAK3N_BASE_URL = `http://127.0.0.1:${port}`;
    try {
      const deepkrak = await adapters.search('deepkrak3n_public_search', 'web', 'public-user');
      assert.strictEqual(deepkrak.available, true);
      assert.strictEqual(deepkrak.hits.length, 1);
      assert.strictEqual(deepkrakMethod, 'POST');
      assert.ok(deepkrakPath.includes('/api/search/username?username=public-user&limit=30'));
    } finally {
      if (previousBaseUrl === undefined) delete process.env.DEEPKRAK3N_BASE_URL;
      else process.env.DEEPKRAK3N_BASE_URL = previousBaseUrl;
    }

    const unavailable = await adapters.search('deepkrak3n_public_search', 'web', 'public-user');
    assert.strictEqual(unavailable.attempted, false);
    assert.ok(unavailable.warning?.includes('not configured'));

    const reddeye = await adapters.search('reddeye_public_reddit', 'reddit', 'public-user');
    assert.strictEqual(reddeye.attempted, false);
    assert.ok(reddeye.warning?.includes('Firefox extension'));

    console.log('Public-profile adapter contract checks passed.');
  } finally {
    await new Promise<void>((resolve) => deepkrakServer.close(() => resolve()));
    await fs.rm(fake.directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});