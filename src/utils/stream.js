import path from 'path';
import { pathToFileURL } from 'url';
import {
  findStaticImports,
  findDynamicImports,
  findExports,
  resolvePath,
} from 'mlly';
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
  matchAll,
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

const lstatIsDirectory = (dir) => {
  try {
    return lstatSync(dir)?.isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

const replaceModules = async (content, contentFolder, modules) => {
  for (const module of modules) {
    const isDir = lstatIsDirectory(path.join(contentFolder, module.specifier));
    const specifier = isDir
      ? `${module.specifier}${path.sep}index`
      : module.specifier;
    const modulePath = await resolvePath(specifier, {
      url: pathToFileURL(contentFolder),
    });
    const moduleRelative = path.relative(contentFolder, modulePath);
    const moduleSpecifier = moduleRelative.startsWith('.')
      ? moduleRelative
      : './'.concat(moduleRelative);
    const moduleCode = module.code.replace(module.specifier, moduleSpecifier);
    content = content.replace(module.code, moduleCode);
  }
  return content;
};

export const createReplaceStream = (tsconfig, rootDir, esm = false) => {
  const { paths = {} } = tsconfig?.compilerOptions;
  const moduleAlias = Object.entries(paths).map(([key, value]) => [
    replaceStar(key),
    replaceStar(value[0]),
  ]);

  return new Transform({
    objectMode: true,
    async transform(chunk, enc, cb) {
      try {
        let content = chunk.content.toString('utf-8');
        const contentFolder = path.resolve(rootDir, path.dirname(chunk.path));
        for (const [alias, aliasRelative] of moduleAlias) {
          const aliasRegexp = new RegExp(alias, 'g');
          const aliasAbsolute = resolveRelative(chunk.depth, aliasRelative);
          content = content.replace(aliasRegexp, aliasAbsolute);
        }
        if (esm) {
          const staticModules = [
            findStaticImports(content),
            findExports(content),
          ]
            .flatMap((module) => module.flat())
            .filter(({ type }) => type !== 'declaration')
            .filter(({ specifier }) => specifier?.includes('./'));

          const dynamicModules = findDynamicImports(content)
            .filter(({ expression }) => expression.includes('./'))
            .map((module) => ({
              ...module,
              specifier: module.expression.replace(/'|"/g, ''),
            }));

          content = await replaceModules(content, contentFolder, staticModules);
          content = await replaceModules(
            content,
            contentFolder,
            dynamicModules
          );
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
