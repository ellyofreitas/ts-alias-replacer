import path from 'path';
import { promisify } from 'util';
import {
  promises as fs,
  createWriteStream,
  statSync,
  existsSync,
  lstatSync,
} from 'fs';
import Stream, { Writable, Transform, Readable } from 'stream';
import {
  calcDepth,
  isFileValid,
  replaceStar,
  resolveRelative,
} from './common.js';
import { exit } from '../cli.js';

export const pipeline = promisify(Stream.pipeline);

export async function* createReadStream(directory, rootDir = directory) {
  const depth = calcDepth(directory, rootDir);
  const joinRoot = (dir) => path.join(directory, dir);

  let raw = await fs.readdir(directory);
  raw = raw.map(joinRoot);

  const dirs = [];
  const files = [];

  await Promise.all(
    raw.map(async (file) => {
      const fileLstat = await fs.lstat(file);
      if (fileLstat.isDirectory()) dirs.push(file);
      if (fileLstat.isFile() && isFileValid(file))
        files.push({ path: file.replace(`${rootDir}/`, ''), depth });
    })
  );

  for (const file of files) yield file;
  for (const dir of dirs) yield* createReadStream(dir, rootDir);
}

export const createImportStream = (root) =>
  new Transform({
    objectMode: true,
    async transform(chunk, enc, cb) {
      try {
        const content = await fs.readFile(path.resolve(root, chunk.path));
        return cb(null, { ...chunk, content });
      } catch (error) {
        return cb(error);
      }
    },
  });

const ESM_IMPORT_LOCAL_PATTERN =
  /(import|import(?:\s.*)(.*)(?:\s.*)from)(?:\s.*)\'(?<name>(\.\/|\.\.\/).*)\'/g;

const tryLstat = (ldir) => {
  try {
    return lstatSync(ldir);
  } catch (error) {
    return null;
  }
};

const resolveJsLstatDir = (dir) => {
  const hasExtension = !!path.extname(dir);
  const isDir = tryLstat(dir);
  if (isDir) return isDir;
  const fileDir = hasExtension ? dir : `${dir}.js`;
  const isFile = tryLstat(fileDir);
  if (isFile) return isFile;
  return null;
};

export const createReplaceStream = (tsconfig, rootDir, esm = false) => {
  const { paths = {} } = tsconfig?.compilerOptions;
  // const esm = true;
  const esmExtension = 'js';
  const moduleAlias = Object.entries(paths).map(([key, value]) => [
    replaceStar(key),
    replaceStar(value[0]),
  ]);

  return new Transform({
    objectMode: true,
    transform(chunk, enc, cb) {
      try {
        let content = chunk.content.toString('utf-8');
        for (const [alias, aliasRelative] of moduleAlias) {
          const aliasRegexp = new RegExp(alias, 'g');
          const aliasAbsolute = resolveRelative(chunk.depth, aliasRelative);
          content = content.replace(aliasRegexp, aliasAbsolute);
        }
        if (esm) {
          for (const r of content.matchAll(ESM_IMPORT_LOCAL_PATTERN)) {
            const { name } = r.groups;
            const dirLstat = resolveJsLstatDir(path.resolve(rootDir, name));
            if (!dirLstat)
              return exit(
                `cannot resolve import ${name} in ${path.relative(
                  process.cwd(),
                  path.resolve(rootDir, chunk.path)
                )}`
              );
            const dirResolved = dirLstat.isFile()
              ? name
              : [name, 'index'].join(path.sep);
            const fileDir = `${dirResolved}.${esmExtension}`;
            content = content.replace(name, fileDir);
          }
        }
        return cb(null, {
          ...chunk,
          content: Buffer.from(content),
        });
      } catch (error) {
        return cb(error);
      }
    },
  });
};

export const createWriteFilesStream = (root) =>
  new Writable({
    objectMode: true,
    async write(chunk, enc, cb) {
      try {
        const readable = Readable.from(chunk.content, { encoding: 'utf-8' });
        const writable = createWriteStream(path.resolve(root, chunk.path), {
          encoding: 'utf-8',
        });
        await pipeline(readable, writable);
        return cb(null);
      } catch (error) {
        return cb(error);
      }
    },
  });
