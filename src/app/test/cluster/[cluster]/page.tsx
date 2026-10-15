import { notFound } from 'next/navigation';
import { ClusterTestRunner } from '@/components/test/ClusterTestRunner';
import { getT } from '@/i18n/server';
import { requireSession } from '@/lib/auth';
import { isClusterId } from '@/lib/tests/clusters';

export const dynamic = 'force-dynamic';

/** Combined test for one skill group (e.g. /test/cluster/data). */
export default async function ClusterTestPage({ params }: { params: { cluster: string } }) {
  await requireSession(['candidate']);
  if (!isClusterId(params.cluster)) notFound();
  const { t } = getT();
  return <ClusterTestRunner cluster={params.cluster} title={t(`cluster.name.${params.cluster}`)} />;
}
