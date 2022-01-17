import { promises as fs } from 'fs';

export async function readFileSafe(path, options) {
  try {
    return await fs.readFile(path, options);
  } catch (error) {
    return null;
  }
}
