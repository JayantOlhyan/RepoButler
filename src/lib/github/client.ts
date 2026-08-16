import { Octokit } from '@octokit/rest';
import { generateAppJwt } from './jwt';

/**
 * Normalizes the private key by replacing any escaped newlines with actual newline characters.
 */
function getPrivateKey(): string {
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY || '';
  return rawKey.replace(/\\n/g, '\n');
}

/**
 * Returns an Octokit client authenticated as the GitHub App (using the App JWT).
 * Used for App-level operations like listing installations.
 */
export function getAppOctokit(): Octokit {
  const appId = process.env.GITHUB_APP_ID || '';
  const privateKey = getPrivateKey();

  if (!appId || !privateKey) {
    throw new Error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY environment variables.');
  }

  const jwt = generateAppJwt(appId, privateKey);
  return new Octokit({
    auth: jwt,
    userAgent: 'repobutler-mvp',
  });
}

/**
 * Requests an installation access token from GitHub for the given installation ID.
 * 
 * @param installationId The GitHub App Installation ID
 * @returns The temporary installation token (valid for 1 hour)
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const appOctokit = getAppOctokit();
  
  const response = await appOctokit.request('POST /app/installations/{installation_id}/access_tokens', {
    installation_id: installationId,
  });

  return response.data.token;
}

/**
 * Returns an Octokit client authenticated as a specific GitHub App Installation.
 * Used for repository-level operations like listing commits, PRs, issues, and workflow runs.
 * 
 * @param installationId The GitHub App Installation ID
 * @returns Authenticated Octokit client
 */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return new Octokit({
    auth: token,
    userAgent: 'repobutler-mvp',
  });
}
