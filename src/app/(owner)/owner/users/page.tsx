import type { Metadata } from 'next';

import { UsersSearch } from './_components/users-search';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — users' };

export default function OwnerUsersPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <h1 className="shrink-0 text-2lg font-semibold">Users</h1>
      <UsersSearch />
    </div>
  );
}
