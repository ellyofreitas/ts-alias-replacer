import path from 'path';

export const calcDepth = (root, rootDir) => {
  const rootDepth = root.split(path.sep).length;
  const rootDirDepth = rootDir.split(path.sep).length;
  return rootDepth - rootDirDepth;
};

export const replaceStar = (s) => s.replace('/*', '');

export const resolveRelative = (depth, dir) => {
  const array = new Array(depth).fill('..');
  if (depth === 0) return `./${dir}`;
  return path.join(...array, dir);
};

export const isFileValid = (file) =>
  ['.js', '.ts', '.mjs'].includes(path.extname(file));

export function matchAll(regex, string, addition) {
  const matches = [];
  for (const match of string.matchAll(regex)) {
    matches.push({
      ...addition,
      ...match.groups,
      code: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}
