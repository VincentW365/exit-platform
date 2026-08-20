import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPrisma, ServiceError, getCaseSurvey } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { SurveyQuestions } from '@/components/SurveyQuestions';
import { verbalDebriefAction } from '../actions';

export const metadata: Metadata = { title: 'Record Verbal Debrief' };
export const dynamic = 'force-dynamic';

export default async function VerbalDebriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getCaseSurvey>>;
  try {
    data = await getCaseSurvey(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  if (!data.capabilities.canRecordVerbal) notFound();
  const inv = data.invitations.find((i) => i.id === sp.invitation);
  if (!inv || !['PENDING', 'MANUALLY_SENT'].includes(inv.status)) notFound();

  const questions = await getPrisma().surveyQuestion.findMany({
    where: { templateId: inv.templateId },
    orderBy: { order: 'asc' },
  });

  return (
    <>
      <h1>Record Verbal Exit Debrief</h1>
      <Feedback err={sp.err} />
      <p className="banner-baseline">
        This response will be stored as <strong>recorded by HR</strong> (verbal debrief channel).
        Answers may be partial; free-text is optional. Responses are restricted HR data.
      </p>
      <form action={verbalDebriefAction} className="stack panel">
        <input type="hidden" name="caseId" value={id} />
        <input type="hidden" name="invitationId" value={inv.id} />
        <SurveyQuestions
          questions={questions.map((q) => ({
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            required: false, // verbal debriefs may be partial
            options: q.options,
            maxLength: q.maxLength,
          }))}
        />
        <button type="submit">Record verbal debrief</button>
      </form>
    </>
  );
}
