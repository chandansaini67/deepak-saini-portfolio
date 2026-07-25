/**
 * Turn media/src/*.mp4 into the three derivatives the site actually ships:
 *
 *   media/preview/<slug>.mp4  6s, silent, small  — the loop that plays in the grid/cylinder
 *   media/full/<slug>.mp4     capped, with audio — what the lightbox plays
 *   media/poster/<slug>.jpg   first frame of the preview — shown before anything loads
 *
 * The poster is grabbed at the same timestamp the preview starts from, so the
 * hand-off from poster to playing video is seamless rather than a visible jump.
 *
 * Also writes data/works.js (the manifest the page reads) and a contact sheet.
 * Re-runnable: existing outputs are skipped unless --force is passed.
 *
 *   node tools/encode.js [--force]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG = require('ffmpeg-static');
const FFPROBE = require('ffprobe-static').path;

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'media', 'src');
const DIRS = {
  preview: path.join(ROOT, 'media', 'preview'),
  full: path.join(ROOT, 'media', 'full'),
  poster: path.join(ROOT, 'media', 'poster'),
};
const FORCE = process.argv.includes('--force');

// Two budgets, because they protect different things.
//
// Posters and previews are the critical path: they load when the page loads, so
// they get a tight cap. Full videos are preload="none" and only ever fetched when
// a visitor clicks a specific reel — they cost nothing on page load, and capping
// them hard would just mean shipping a video editor's work looking compressed.
const BUDGET_CRITICAL_MB = 10;
const BUDGET_TOTAL_MB = 200;

const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));

// Vertical reels don't need 1080p — 720x1280 is indistinguishable in a lightbox
// and roughly half the bytes. Horizontal gets more width because it has more to say.
const SIZES = {
  vertical: { preview: 480, full: 720 },
  horizontal: { preview: 640, full: 1280 },
};

const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

function probe(file) {
  const raw = run(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    file,
  ]).toString();
  const json = JSON.parse(raw);
  const v = json.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`no video stream in ${file}`);

  // Rotation metadata means the stored frame is sideways from how it displays.
  const rotation = Math.abs(
    Number(v.rotation ?? (v.side_data_list || []).find((d) => d.rotation)?.rotation ?? 0)
  );
  const swap = rotation === 90 || rotation === 270;
  const width = swap ? v.height : v.width;
  const height = swap ? v.width : v.height;

  return {
    width,
    height,
    duration: Number(json.format.duration) || 0,
    hasAudio: json.streams.some((s) => s.codec_type === 'audio'),
  };
}

const mmss = (s) => {
  const t = Math.round(s);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function aspectLabel(w, h) {
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.06) return '9:16';
  if (Math.abs(r - 16 / 9) < 0.08) return '16:9';
  if (Math.abs(r - 1) < 0.06) return '1:1';
  if (Math.abs(r - 4 / 5) < 0.05) return '4:5';
  return `${w}:${h}`;
}

const mb = (f) => fs.statSync(f).size / 1e6;

/**
 * True only if the file exists AND decodes. Plain existsSync isn't enough:
 * a run killed mid-encode leaves a truncated mp4 behind, and skipping on
 * existence alone would quietly ship it forever. Learned the hard way.
 */
function usable(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 1024) return false;
  try {
    if (file.endsWith('.jpg')) return true;   // a short JPG is still a valid JPG
    return probe(file).duration > 0.05;
  } catch {
    return false;
  }
}

/**
 * Choose a poster frame by sampling the finished preview and keeping the
 * sharpest candidate.
 *
 * Two earlier attempts failed on real footage: a fixed timestamp landed on
 * title cards and mid-transition composites, and ffmpeg's `thumbnail` filter
 * optimises for "representative", which on panning drone shots means motion
 * blur. Sharpness is what actually matters for a thumbnail.
 *
 * The proxy is JPEG size at fixed quality: detailed frames compress badly and
 * come out large, while blurred and near-black frames compress to almost
 * nothing. Crude, but it sorts blur from sharp reliably and costs 8 cheap
 * frame extractions per video.
 */
function pickPoster(previewFile, dest, previewLen) {
  const SAMPLES = 8;
  const tmpDir = path.join(ROOT, 'media', '.posterpick');
  fs.mkdirSync(tmpDir, { recursive: true });

  let best = null;
  for (let i = 0; i < SAMPLES; i++) {
    // Skip the very first and last frames — cuts often sit on the boundary.
    const t = (previewLen * (i + 1)) / (SAMPLES + 1);
    const candidate = path.join(tmpDir, `c${i}.jpg`);
    try {
      run(FFMPEG, ['-y', '-ss', t.toFixed(2), '-i', previewFile, '-frames:v', '1', '-q:v', '4', candidate]);
      const size = fs.statSync(candidate).size;
      if (!best || size > best.size) best = { file: candidate, size, t };
    } catch {
      /* a sample that fails to extract just isn't a candidate */
    }
  }

  if (best) fs.copyFileSync(best.file, dest);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return best;
}

function encodeOne(video) {
  const src = path.join(SRC, `${video.slug}.mp4`);
  if (!fs.existsSync(src)) {
    console.log(`  ! ${video.slug}: missing from media/src, skipping`);
    return null;
  }

  const info = probe(src);
  const orientation = info.height >= info.width ? 'vertical' : 'horizontal';
  const size = SIZES[orientation];

  // Start well into the edit. At 10% several clips opened on a title card or a
  // cut, which made for dead-looking loops; 18% lands in the body of the piece.
  // `startAt` in sources.json pins it for a clip the rule gets wrong.
  const auto = Math.min(Math.max(1, info.duration * 0.18), Math.max(0, info.duration - 6.5));
  const start = typeof video.startAt === 'number'
    ? Math.min(Math.max(0, video.startAt), Math.max(0, info.duration - 1))
    : auto;
  const previewLen = Math.min(6, Math.max(2, info.duration - start));

  const out = {
    preview: path.join(DIRS.preview, `${video.slug}.mp4`),
    full: path.join(DIRS.full, `${video.slug}.mp4`),
    poster: path.join(DIRS.poster, `${video.slug}.jpg`),
  };

  const common = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

  if (FORCE || !usable(out.preview)) {
    run(FFMPEG, [
      '-y', '-ss', start.toFixed(2), '-t', previewLen.toFixed(2), '-i', src,
      '-vf', `scale=${size.preview}:-2:flags=lanczos`,
      ...common,
      '-crf', '30', '-preset', 'slow', '-r', '25',
      '-an',
      out.preview,
    ]);
  }

  if (FORCE || !usable(out.full)) {
    const audio = info.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
    // The estate clips are 60fps 1080x1920, which is most of why the sources are
    // 640MB. Halving to 30fps is the single biggest saving available and is
    // invisible in a lightbox on a laptop.
    run(FFMPEG, [
      '-y', '-i', src,
      '-vf', `scale=${size.full}:-2:flags=lanczos,fps=30`,
      ...common,
      '-crf', '26', '-preset', 'medium',
      ...audio,
      out.full,
    ]);
  }

  if (FORCE || !usable(out.poster)) {
    if (typeof video.posterAt === 'number') {
      // Hand-picked: seconds into the preview, for the clips where no automatic
      // rule finds a good frame (a shot that pans throughout, say).
      run(FFMPEG, [
        '-y', '-ss', String(video.posterAt), '-i', out.preview,
        '-frames:v', '1', '-q:v', '4', out.poster,
      ]);
    } else {
      pickPoster(out.preview, out.poster, previewLen);
    }
  }

  const previewInfo = probe(out.preview);
  console.log(
    `  + ${video.slug.padEnd(16)} ${orientation.padEnd(10)} ${mmss(info.duration).padEnd(6)}` +
      ` preview ${mb(out.preview).toFixed(2)}MB  full ${mb(out.full).toFixed(1)}MB`
  );

  return {
    slug: video.slug,
    title: video.title,
    client: video.client,
    category: video.category,
    orientation,
    aspect: aspectLabel(info.width, info.height),
    width: previewInfo.width,
    height: previewInfo.height,
    duration: mmss(info.duration),
    // Every clip so far is a 9:16 reel; this only drives the duration badge,
    // not the card shape. 90s rather than 60s so a 61s reel isn't miscalled.
    longForm: info.duration > 90,
    poster: `media/poster/${video.slug}.jpg`,
    preview: `media/preview/${video.slug}.mp4`,
    full: `media/full/${video.slug}.mp4`,
  };
}

/** One image with every poster tiled, so a human can pick the running order. */
function contactSheet(works) {
  if (!works.length) return;
  const listFile = path.join(ROOT, 'media', '.sheet-inputs.txt');
  const inputs = [];
  for (const w of works) inputs.push('-i', path.join(ROOT, w.poster));

  const cols = 5;
  const rows = Math.ceil(works.length / cols);
  const filter =
    works
      .map(
        (_, i) =>
          `[${i}:v]scale=300:300:force_original_aspect_ratio=decrease,` +
          `pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x0A0A0C,` +
          `drawtext=text='${i + 1}':x=8:y=8:fontsize=28:fontcolor=0xFF7A2F:` +
          `box=1:boxcolor=0x0A0A0C@0.7:boxborderw=6[t${i}]`
      )
      .join(';') +
    ';' +
    works.map((_, i) => `[t${i}]`).join('') +
    `xstack=inputs=${works.length}:layout=${works
      .map((_, i) => `${(i % cols) * 300}_${Math.floor(i / cols) * 300}`)
      .join('|')}:fill=0x0A0A0C[out]`;

  const dest = path.join(ROOT, 'media', 'contact-sheet.jpg');
  try {
    run(FFMPEG, ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-q:v', '3', dest]);
    console.log(`\nContact sheet: media/contact-sheet.jpg (${cols}x${rows})`);
  } catch (err) {
    console.log(`\nContact sheet failed (not fatal): ${String(err.stderr || err).slice(-300)}`);
  }
  if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
}

(async () => {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

  console.log(`Encoding ${sources.videos.length} videos${FORCE ? ' (forced)' : ''}\n`);
  const works = sources.videos.map(encodeOne).filter(Boolean);

  const banner =
    '// GENERATED by tools/encode.js — do not edit by hand.\n' +
    '// Plain script, not JSON+fetch, so index.html still works opened straight from disk.\n';
  fs.writeFileSync(
    path.join(ROOT, 'data', 'works.js'),
    `${banner}window.WORKS = ${JSON.stringify(works, null, 2)};\n`
  );

  contactSheet(works);

  const dirSize = (d) =>
    fs.readdirSync(d).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0) / 1e6;

  const critical = dirSize(DIRS.preview) + dirSize(DIRS.poster);
  const total = critical + dirSize(DIRS.full);

  console.log(`\ndata/works.js written with ${works.length} entries`);
  console.log(`  critical path (posters + previews): ${critical.toFixed(1)}MB / ${BUDGET_CRITICAL_MB}MB`);
  console.log(`  total shipped media:                ${total.toFixed(1)}MB / ${BUDGET_TOTAL_MB}MB`);

  let over = false;
  if (critical > BUDGET_CRITICAL_MB) {
    console.error(`\nCRITICAL PATH OVER BUDGET by ${(critical - BUDGET_CRITICAL_MB).toFixed(1)}MB.`);
    console.error('Shrink the preview width or raise its CRF — this is what every visitor downloads.');
    over = true;
  }
  if (total > BUDGET_TOTAL_MB) {
    console.error(`\nTOTAL OVER BUDGET by ${(total - BUDGET_TOTAL_MB).toFixed(1)}MB — raise the full CRF.`);
    over = true;
  }
  if (over) process.exit(1);
})();
