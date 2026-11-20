import {
  deleteSubmissionPhotos,
  publishSubmission,
  sendDecisionEmail,
  verifyReviewToken,
  type ReviewFindings,
} from './lib/submission-review.js';
import { createSubmissionDb } from './lib/submission-db.js';

export const config = { runtime: 'nodejs' };

function page(title: string, message: string, tone: 'success' | 'error' = 'success'): Response {
  const color = tone === 'success' ? '#10b981' : '#e11d48';
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
     <body style="font-family:system-ui,sans-serif;max-width:640px;margin:4rem auto;padding:1rem;color:#0f172a">
       <h1 style="color:${color}">${title}</h1><p>${message}</p>
     </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.REVIEW_SECRET;
  if (!secret) return page('Not configured', 'REVIEW_SECRET is missing.', 'error');

  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const requestedDecision = url.searchParams.get('decision');
  const verified = verifyReviewToken(token, secret);

  if (!verified || verified.decision !== requestedDecision) {
    return page('Invalid link', 'This review link is invalid or has been altered.', 'error');
  }

  const db = createSubmissionDb();
  try {
    const submission = await db.get(verified.id);
    if (!submission) return page('Not found', 'This submission no longer exists.', 'error');

    if (submission.status === 'approved' || submission.status === 'rejected') {
      return page('Already reviewed', `This submission was already ${submission.status}.`);
    }

    const findings = (submission.review_findings ?? {}) as Partial<ReviewFindings>;
    const findingsRecord = findings as unknown as Record<string, unknown>;

    if (verified.decision === 'approve') {
      await publishSubmission(submission, findings);
      await db.setDecision(verified.id, 'approved', {
        ...findingsRecord,
        publishedAt: new Date().toISOString(),
      });
    } else {
      await db.setDecision(verified.id, 'rejected', findingsRecord);
    }

    await deleteSubmissionPhotos(submission.photo_urls);
    await sendDecisionEmail(submission, verified.decision === 'approve' ? 'approved' : 'rejected');

    return page(
      verified.decision === 'approve' ? 'Published' : 'Rejected',
      `${submission.station_name} was ${verified.decision === 'approve' ? 'published to Ruvo' : 'rejected'}. Photos were removed.`
    );
  } catch (error) {
    console.error('Decision failed:', error);
    return page(
      'Decision failed',
      error instanceof Error ? error.message : String(error),
      'error'
    );
  } finally {
    await db.close();
  }
}
