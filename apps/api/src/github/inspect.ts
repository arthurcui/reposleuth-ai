import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { OctokitProvider } from './OctokitProvider.js';
import { RepositoryError } from './RepositoryProvider.js';

config({ path: fileURLToPath(new URL('../../../../.env.local', import.meta.url)), quiet: true });
const [repository, issue] = process.argv.slice(2);
if (!repository) {
  console.error('Usage: npm run inspect -w @reposleuth/api -- owner/repo [issue-number]');
  process.exitCode = 1;
} else {
  try {
    const provider = await OctokitProvider.connect(repository, { token: process.env.GITHUB_TOKEN });
    console.log(JSON.stringify({ revision: provider.revision, files: await provider.listFiles(), ...(issue ? { issue: await provider.getIssue(Number(issue)) } : {}) }, null, 2));
  } catch (error) {
    console.error(error instanceof RepositoryError ? `${error.code}: ${error.message}` : 'Repository inspection failed.');
    process.exitCode = 1;
  }
}
