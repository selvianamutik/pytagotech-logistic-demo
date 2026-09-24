import { getSession } from '@/lib/auth';
import { handleMasterDataImport } from '@/lib/api/master-data-import';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { isPlainObject } from '@/lib/api/data-helpers';
import { hasPermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  const originError = ensureSameOriginRequest(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'DRIVER') {
    return jsonNoStore({ error: 'Driver tidak diizinkan mengakses API admin' }, { status: 403 });
  }
  if (!hasPermission(session, 'dataImports', 'view')) {
    return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
  }

  const parsedBody = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsedBody) return parsedBody.error;

  const body = isPlainObject(parsedBody.data) ? parsedBody.data as Record<string, unknown> : {};
  return handleMasterDataImport(session, body);
}
