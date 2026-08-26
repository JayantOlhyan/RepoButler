import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { syncRepository } from '@/lib/github/sync';
import { generateWeeklyReportSummary } from '@/lib/ai/provider';
import { sendEmail } from '@/lib/notifications/email';
import { Clock } from '@/lib/utils/clock';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const users = await prisma.user.findMany();
    const today = Clock.now();
    today.setHours(0, 0, 0, 0);
    
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    console.log(`Cron weekly-report started for ${users.length} users`);

    for (const user of users) {
      // 1. Fetch monitored repos for this user
      const installations = await prisma.gitHubInstallation.findMany({
        where: { userId: user.id },
      });
      const installationIds = installations.map(i => i.id);

      const repositories = await prisma.repository.findMany({
        where: {
          installationId: { in: installationIds },
          isArchived: false,
          settings: { monitoringEnabled: true }, // We are reusing monitoringEnabled for now
        },
        include: {
          attentionItems: { where: { status: 'OPEN' } },
        },
      });

      if (repositories.length === 0) continue;

      // 2. Perform fresh synchronization for all repos
      for (const repo of repositories) {
        try {
          await syncRepository(repo.id);
        } catch (syncErr) {
          console.error(`Failed to sync ${repo.fullName} during weekly report generation:`, syncErr);
        }
      }

      // Re-fetch repositories to get updated attention items after sync
      const updatedRepos = await prisma.repository.findMany({
        where: { id: { in: repositories.map(r => r.id) } },
        include: {
          attentionItems: { where: { status: 'OPEN' } },
          commits: { where: { occurredAt: { gte: oneWeekAgo } } },
          pullRequests: { where: { updatedAt: { gte: oneWeekAgo } } },
          issues: { where: { updatedAt: { gte: oneWeekAgo } } },
        },
      });

      // 3. Collect all active attention items
      const attentionItems = updatedRepos.flatMap(r => 
        r.attentionItems.map(item => ({
          ...item,
          repoName: r.name,
          htmlUrl: r.htmlUrl,
        }))
      ).sort((a, b) => {
        const severityMap: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return (severityMap[b.severity] || 0) - (severityMap[a.severity] || 0);
      });

      // 4. Calculate changed repositories count over the past week
      const reposChangedCount = updatedRepos.filter(r => 
        r.commits.length > 0 || r.pullRequests.length > 0 || r.issues.length > 0
      ).length;

      // 5. Generate AI / Template summary
      const summary = await generateWeeklyReportSummary({
        userName: user.username,
        repositoriesChanged: reposChangedCount,
        attentionItems: attentionItems.map(item => ({
          repoName: item.repoName,
          type: item.type,
          severity: item.severity,
          title: item.title,
          description: item.description,
        })),
      });

      // 6. Create Weekly Report in Database
      const report = await prisma.weeklyReport.upsert({
        where: {
          userId_endDate: {
            userId: user.id,
            endDate: today,
          },
        },
        update: {
          startDate: oneWeekAgo,
          summary,
          attentionCount: attentionItems.length,
          repositoriesChanged: reposChangedCount,
          generatedAt: Clock.now(),
        },
        create: {
          userId: user.id,
          startDate: oneWeekAgo,
          endDate: today,
          summary,
          attentionCount: attentionItems.length,
          repositoriesChanged: reposChangedCount,
          generatedAt: Clock.now(),
        },
      });

      // Clear old items and write new ranked report items
      await prisma.weeklyReportItem.deleteMany({
        where: { weeklyReportId: report.id },
      });

      const reportItemsData = attentionItems.slice(0, 10).map((item, idx) => {
        const repo = updatedRepos.find(r => r.name === item.repoName);
        return {
          weeklyReportId: report.id,
          repositoryId: repo?.id || '',
          attentionItemId: item.id,
          rank: idx + 1,
          reason: `${item.severity}: ${item.title}. ${item.description}`,
        };
      });

      if (reportItemsData.length > 0) {
        await prisma.weeklyReportItem.createMany({
          data: reportItemsData.filter(d => d.repositoryId !== ''),
        });
      }

      // 7. Send Weekly Report Email if enabled
      if (user.email) {
        const startDateStr = oneWeekAgo.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const endDateStr = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        
        let emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
            <h2 style="font-size: 20px; font-weight: 800; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 20px;">
              RepoButler Weekly Report
            </h2>
            <p style="font-size: 13px; font-weight: 700; color: #9ca3af; text-transform: uppercase; margin-bottom: 20px;">
              ${startDateStr} - ${endDateStr}
            </p>
            <p style="font-size: 15px; font-weight: 500; margin-bottom: 30px;">
              ${summary}
            </p>
        `;

        if (attentionItems.length > 0) {
          emailHtml += `
            <h3 style="font-size: 14px; font-weight: 800; text-transform: uppercase; color: #4b5563; margin-bottom: 15px;">
              Current Action Items (${attentionItems.length})
            </h3>
            <div style="margin-bottom: 40px;">
          `;

          attentionItems.slice(0, 10).forEach((item) => {
            let labelColor = '#9ca3af';
            if (item.severity === 'CRITICAL') labelColor = '#ef4444';
            else if (item.severity === 'HIGH') labelColor = '#f59e0b';
            else if (item.severity === 'MEDIUM') labelColor = '#fbbf24';

            emailHtml += `
              <div style="padding: 15px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 15px;">
                <div style="margin-bottom: 6px;">
                  <span style="font-size: 10px; font-weight: 800; color: white; background-color: ${labelColor}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-right: 8px;">
                    ${item.severity}
                  </span>
                  <span style="font-size: 12px; font-weight: 700; color: #6b7280;">
                    ${item.repoName}
                  </span>
                </div>
                <h4 style="font-size: 15px; font-weight: 700; margin: 0 0 6px 0;">${item.title}</h4>
                <p style="font-size: 13px; color: #4b5563; margin: 0 0 10px 0;">${item.description}</p>
                <a href="${item.htmlUrl}" style="font-size: 12px; font-weight: 700; color: #111827; text-decoration: underline;">
                  View on GitHub &rarr;
                </a>
              </div>
            `;
          });

          emailHtml += `</div>`;
        }

        emailHtml += `
            <div style="border-t: 1px solid #e5e7eb; pt: 20px; font-size: 12px; color: #9ca3af;">
              <p>RepoButler Weekly Summary. Keeping your repositories healthy.</p>
            </div>
          </div>
        `;

        await sendEmail({
          to: user.email,
          subject: `RepoButler Weekly Report: ${startDateStr} - ${endDateStr}`,
          html: emailHtml,
        });
      }
    }

    return NextResponse.json({ success: true, usersProcessed: users.length });
  } catch (error) {
    console.error('Error in weekly-report cron:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
