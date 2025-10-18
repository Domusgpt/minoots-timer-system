#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { extname } from 'node:path';

const forbiddenExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.webp',
  '.ico',
  '.icns',
  '.psd',
  '.ai',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
  '.m4v',
  '.avi',
  '.mpg',
  '.mpeg',
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.xz',
  '.7z',
  '.pdf'
]);

function getTrackedFiles() {
  const output = execSync('git ls-files', { encoding: 'utf8' }).trim();
  if (!output) {
    return [];
  }
  return output.split('\n').map((file) => file.trim()).filter(Boolean);
}

const trackedFiles = getTrackedFiles();
const offenders = trackedFiles.filter((file) => {
  const ext = extname(file).toLowerCase();
  return forbiddenExtensions.has(ext);
});

if (offenders.length > 0) {
  console.error('\n❌ Binary assets detected in the tracked files list:');
  offenders.forEach((file) => console.error(` - ${file}`));
  console.error('\nMove these files to a git-ignored directory (for example, apps/mobile/assets/) or store them externally before committing.');
  process.exit(1);
}

console.log('✅ No tracked binary assets detected.');
