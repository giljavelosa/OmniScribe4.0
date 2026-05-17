import type { Metadata } from 'next';

import { UsersSearch } from './_components/users-search';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — users' };

export default function OwnerUsersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Users</h1>
      <UsersSearch />
    </div>
  );
}
