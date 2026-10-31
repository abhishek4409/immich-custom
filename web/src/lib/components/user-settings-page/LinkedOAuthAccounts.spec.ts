import { UserOAuthIdentityRole, UserOAuthIdentityStatus, type UserOAuthIdentityResponseDto } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import LinkedOAuthAccounts from './LinkedOAuthAccounts.svelte';

const identity = (dto: Partial<UserOAuthIdentityResponseDto>): UserOAuthIdentityResponseDto => ({
  id: 'identity-id',
  role: UserOAuthIdentityRole.Member,
  status: UserOAuthIdentityStatus.Active,
  email: 'someone@gmail.com',
  name: null,
  inviteExpiresAt: null,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  ...dto,
});

const owner = identity({ id: 'owner-id', role: UserOAuthIdentityRole.Owner, email: 'owner@gmail.com' });
const member = identity({ id: 'member-id', email: 'member@gmail.com' });
const pending = identity({
  id: 'pending-id',
  status: UserOAuthIdentityStatus.Pending,
  email: 'pending@gmail.com',
  inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
});

describe('LinkedOAuthAccounts', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const mockList = (dto: { canManage: boolean; sharingEnabled?: boolean; currentIdentityId?: string | null }) =>
    sdkMock.getMyOAuthIdentities.mockResolvedValue({
      sharingEnabled: true,
      currentIdentityId: null,
      identities: [owner, member, pending],
      ...dto,
    });

  it('lets the owner manage every account', async () => {
    mockList({ canManage: true, currentIdentityId: 'owner-id' });

    render(LinkedOAuthAccounts, { isAdmin: false });

    expect(await screen.findByText('member@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('owner@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('pending@gmail.com')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Make owner' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Renew invite' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Invite account' })).toBeInTheDocument();
  });

  it('only lets a member remove themselves', async () => {
    mockList({ canManage: false, currentIdentityId: 'member-id' });

    render(LinkedOAuthAccounts, { isAdmin: false });

    expect(await screen.findByText('member@gmail.com')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Make owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite account' })).not.toBeInTheDocument();
  });

  it('hides invites when sharing is disabled', async () => {
    mockList({ canManage: true, sharingEnabled: false });

    render(LinkedOAuthAccounts, { isAdmin: false });

    expect(await screen.findByText(/has not enabled sharing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite account' })).not.toBeInTheDocument();
  });

  it('warns on an admin user', async () => {
    mockList({ canManage: true });

    render(LinkedOAuthAccounts, { isAdmin: true });

    expect(await screen.findByText(/full admin access/)).toBeInTheDocument();
  });

  it('uses the admin endpoints for another user', async () => {
    sdkMock.getUserOAuthIdentitiesAdmin.mockResolvedValue({
      canManage: true,
      sharingEnabled: true,
      currentIdentityId: null,
      identities: [owner],
    });

    render(LinkedOAuthAccounts, { userId: 'user-id', isAdmin: false });

    expect(await screen.findByText('owner@gmail.com')).toBeInTheDocument();
    expect(sdkMock.getUserOAuthIdentitiesAdmin).toHaveBeenCalledWith({ id: 'user-id' });
    expect(sdkMock.getMyOAuthIdentities).not.toHaveBeenCalled();
  });
});
