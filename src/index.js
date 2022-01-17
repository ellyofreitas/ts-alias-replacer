import path from 'path';
import { resolveArguments, exit } from './cli.js';
import { readFileSafe } from './utils/file-system.js';
import {
  pipeline,
  createImportStream,
  createReadStream,
  createReplaceStream,
  createWriteFilesStream,
} from './utils/stream.js';

const PARAMS = Object.freeze(['tsconfig', 'out', 'esm']);

const args = resolveArguments(PARAMS);

const tsconfigJSON = await readFileSafe(
  path.join(process.cwd(), args?.tsconfig ?? 'tsconfig.json'),
  { encoding: 'utf-8' }
);
const packageJson = await readFileSafe(
  path.join(process.cwd(), 'package.json'),
  { encoding: 'utf-8' }
);

if (!tsconfigJSON) exit('tsconfig not found!');

const tsconfig = JSON.parse(tsconfigJSON);
const packageConfig = JSON.parse(packageJson);

const target = path.normalize(args.$1 ?? tsconfig.compilerOptions?.outDir);
const output = path.normalize(args.out ?? target);
const esm = packageConfig?.type === 'module' ?? args.esm;

if (!target) exit('target no specified!');

await pipeline(
  createReadStream(target),
  createImportStream(target),
  createReplaceStream(tsconfig, target, esm),
  createWriteFilesStream(output)
);
