import { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import prisma from '@/lib/db/prisma';

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_APP_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || '',
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name || profile.login,
          email: profile.email,
          image: profile.avatar_url,
          login: profile.login,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'github' && profile) {
        // GitHub profile ID is an integer
        const githubUserId = parseInt((profile as any).id, 10);
        const username = (profile as any).login || user.name || '';
        const email = profile.email || null;
        const avatarUrl = (profile as any).avatar_url || user.image || null;

        if (!isNaN(githubUserId)) {
          try {
            await prisma.user.upsert({
              where: { githubUserId },
              update: {
                username,
                email,
                avatarUrl,
              },
              create: {
                githubUserId,
                username,
                email,
                avatarUrl,
              },
            });
          } catch (error) {
            console.error('Error saving user on sign in:', error);
          }
        }
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        const githubUserId = parseInt(token.sub, 10);
        if (!isNaN(githubUserId)) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { githubUserId },
            });
            if (dbUser) {
              (session.user as any).id = dbUser.id;
              (session.user as any).username = dbUser.username;
            }
          } catch (error) {
            console.error('Error fetching user for session:', error);
          }
        }
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'fallback-secret-for-dev',
  pages: {
    signIn: '/',
    error: '/',
  },
};
