import { NextResponse } from 'next/server';

export async function GET() {
  const appUrl = process.env.GITHUB_APP_URL || `https://github.com/apps/${process.env.GITHUB_APP_NAME || 'repobutler'}`;
  return NextResponse.redirect(`${appUrl}/installations/new`);
}
