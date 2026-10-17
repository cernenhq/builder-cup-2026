// Photo storage interface: put(key, buffer, contentType), get(key) -> { buffer, contentType } | null,
// clear(). Two adapters: local disk for development, Cloud Storage for Cloud Run.
// Photos are stored exactly as uploaded, so EXIF date and GPS stay in the file.
const fs = require('fs/promises');
const path = require('path');

function createLocalPhotos(dir) {
  const root = path.resolve(dir);
  const safe = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('Bad photo key');
    return p;
  };
  return {
    kind: 'local',
    async put(key, buffer, contentType) {
      const p = safe(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, buffer);
      await fs.writeFile(`${p}.type`, contentType || 'application/octet-stream');
    },
    async get(key) {
      try {
        const p = safe(key);
        const [buffer, type] = await Promise.all([fs.readFile(p), fs.readFile(`${p}.type`, 'utf8').catch(() => 'image/jpeg')]);
        return { buffer, contentType: type };
      } catch (e) {
        return null;
      }
    },
    async clear() {
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

function createGcsPhotos(bucketName) {
  // Loaded lazily so local runs do not need Google credentials.
  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(bucketName);
  return {
    kind: 'gcs',
    async put(key, buffer, contentType) {
      await bucket.file(key).save(buffer, { contentType, resumable: false });
    },
    async get(key) {
      try {
        const f = bucket.file(key);
        const [buffer] = await f.download();
        const [meta] = await f.getMetadata();
        return { buffer, contentType: meta.contentType || 'image/jpeg' };
      } catch (e) {
        return null;
      }
    },
    async clear() {
      // Never wipes a bucket automatically. Re-seeding overwrites seed keys only.
    }
  };
}

function createPhotos(config) {
  if (config.photos === 'gcs') {
    if (!config.photoBucket) throw new Error('PHOTOS=gcs needs PHOTO_BUCKET');
    return createGcsPhotos(config.photoBucket);
  }
  return createLocalPhotos(config.photoDir);
}

module.exports = { createPhotos, createLocalPhotos };
