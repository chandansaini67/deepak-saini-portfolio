/**
 * Download every source video listed in sources.json into media/src/.
 *
 * Google serves small files straight from /uc?export=download, but anything over
 * ~100MB returns an HTML interstitial ("Google Drive can't scan this file for
 * viruses") instead of the bytes. Two of ours trip that: estate-01 (80MB) and
 * estate-05 (217MB). We handle it by parsing the form out of that page and
 * re-issuing the request with the confirm token it hands us.
 *
 * Already-downloaded files are skipped, so this is safe to re-run.
 *
 *   node tools/fetch-drive.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'media', 'src');
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** GET that follows redirects and carries cookies along, resolving to the raw response. */
function get(url, cookies = '', depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 6) return reject(new Error('too many redirects'));
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, ...(cookies ? { Cookie: cookies } : {}) } },
      (res) => {
        const setCookie = (res.headers['set-cookie'] || [])
          .map((c) => c.split(';')[0])
          .join('; ');
        const merged = [cookies, setCookie].filter(Boolean).join('; ');

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(get(next, merged, depth + 1));
        }
        res.cookies = merged;
        resolve(res);
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}

function readAll(res) {
  return new Promise((resolve, reject) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve(body));
    res.on('error', reject);
  });
}

function streamToFile(res, dest, expectedBytes) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    let got = 0;
    let lastLog = 0;
    const total = Number(res.headers['content-length']) || expectedBytes || 0;

    res.on('data', (c) => {
      got += c.length;
      const now = Date.now();
      if (now - lastLog > 3000) {
        lastLog = now;
        const pct = total ? ` (${Math.round((got / total) * 100)}%)` : '';
        process.stdout.write(`      ${(got / 1e6).toFixed(1)}MB${pct}\n`);
      }
    });
    res.pipe(out);
    out.on('finish', () => {
      out.close(() => {
        fs.renameSync(tmp, dest);
        resolve(got);
      });
    });
    out.on('error', reject);
    res.on('error', reject);
  });
}

/** Pull the confirm-download form fields out of Google's virus-scan interstitial. */
function parseConfirmForm(html) {
  const action = html.match(/action="([^"]+)"/);
  if (!action) return null;
  const params = new URLSearchParams();
  for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)) {
    params.set(m[1], m[2]);
  }
  if (!params.has('confirm')) params.set('confirm', 't');
  return `${action[1].replace(/&amp;/g, '&')}?${params.toString()}`;
}

async function download(video) {
  const dest = path.join(OUT_DIR, `${video.slug}.mp4`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  = ${video.slug} already present (${(fs.statSync(dest).size / 1e6).toFixed(1)}MB)`);
    return;
  }

  const expected = video.bytes ? ` ~${(video.bytes / 1e6).toFixed(1)}MB` : '';
  console.log(`  > ${video.slug}${expected}`);

  // drive.usercontent.google.com with confirm=t is the modern direct path and
  // skips the interstitial for most files.
  let res = await get(
    `https://drive.usercontent.google.com/download?id=${video.id}&export=download&confirm=t`
  );

  const type = String(res.headers['content-type'] || '');
  if (type.includes('text/html')) {
    const html = await readAll(res);
    const confirmUrl = parseConfirmForm(html);
    if (!confirmUrl) {
      throw new Error(`${video.slug}: got HTML back and could not find a confirm form`);
    }
    res = await get(confirmUrl, res.cookies);
    if (String(res.headers['content-type'] || '').includes('text/html')) {
      throw new Error(`${video.slug}: still HTML after confirm — file may not be public`);
    }
  }

  const bytes = await streamToFile(res, dest, video.bytes);
  if (bytes < 10000) {
    fs.unlinkSync(dest);
    throw new Error(`${video.slug}: only ${bytes} bytes, that is not a video`);
  }
  console.log(`  + ${video.slug} -> ${(bytes / 1e6).toFixed(1)}MB`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Fetching ${sources.videos.length} videos into media/src/\n`);

  const failed = [];
  for (const video of sources.videos) {
    try {
      await download(video);
    } catch (err) {
      console.error(`  ! ${err.message}`);
      failed.push(video.slug);
    }
  }

  const total = fs
    .readdirSync(OUT_DIR)
    .reduce((n, f) => n + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`\nDone. media/src is ${(total / 1e6).toFixed(1)}MB`);
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
})();
