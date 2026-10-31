<script lang="ts">
  import { goto } from '$app/navigation';
  import { Route } from '$lib/route';
  import { locale } from '$lib/stores/preferences.store';
  import { createDateFormatter, findLocale } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    getMyOAuthIdentities,
    getUserOAuthIdentitiesAdmin,
    inviteMyOAuthIdentity,
    inviteUserOAuthIdentityAdmin,
    removeMyOAuthIdentity,
    removeUserOAuthIdentityAdmin,
    transferMyOAuthIdentity,
    transferUserOAuthIdentityAdmin,
    UserOAuthIdentityRole,
    UserOAuthIdentityStatus,
    type UserOAuthIdentityListResponseDto,
    type UserOAuthIdentityResponseDto,
  } from '@immich/sdk';
  import { Alert, Badge, Button, Field, Input, LoadingSpinner, modalManager, Text, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    /** manage this user through the admin endpoints instead of the current user */
    userId?: string;
    isAdmin: boolean;
    onLoad?: (list: UserOAuthIdentityListResponseDto) => void;
  };

  const { userId, isAdmin, onLoad }: Props = $props();

  let list = $state<UserOAuthIdentityListResponseDto>();
  let email = $state('');
  let inviting = $state(false);

  const dateFormatter = $derived(createDateFormatter(findLocale($locale).code));

  const refresh = async () => {
    try {
      list = await (userId ? getUserOAuthIdentitiesAdmin({ id: userId }) : getMyOAuthIdentities());
      onLoad?.(list);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_linked_accounts'));
    }
  };

  onMount(refresh);

  const invite = (inviteEmail: string) => {
    const userOAuthIdentityInviteDto = { email: inviteEmail };
    return userId
      ? inviteUserOAuthIdentityAdmin({ id: userId, userOAuthIdentityInviteDto })
      : inviteMyOAuthIdentity({ userOAuthIdentityInviteDto });
  };

  const handleInvite = async (event: SubmitEvent) => {
    event.preventDefault();

    if (isAdmin) {
      const confirmed = await modalManager.showDialog({
        prompt: $t('linked_accounts_invite_admin_confirmation'),
        confirmColor: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    inviting = true;
    try {
      await invite(email.trim());
      email = '';
      toastManager.primary($t('linked_accounts_invited'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_invite_linked_account'));
    } finally {
      inviting = false;
      await refresh();
    }
  };

  const handleRenew = async ({ email }: UserOAuthIdentityResponseDto) => {
    try {
      await invite(email);
      toastManager.primary($t('linked_accounts_invited'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_invite_linked_account'));
    } finally {
      await refresh();
    }
  };

  const handleRemove = async ({ id, status }: UserOAuthIdentityResponseDto) => {
    const isSelf = id === list?.currentIdentityId;
    const prompt = () => {
      if (isSelf) {
        return $t('linked_accounts_remove_self_confirmation');
      }

      return status === UserOAuthIdentityStatus.Active
        ? $t('linked_accounts_remove_confirmation')
        : $t('linked_accounts_remove_invite_confirmation');
    };

    const confirmed = await modalManager.showDialog({ prompt: prompt(), confirmColor: 'danger' });
    if (!confirmed) {
      return;
    }

    try {
      await (userId ? removeUserOAuthIdentityAdmin({ id: userId, identityId: id }) : removeMyOAuthIdentity({ id }));
      // removing the account this session belongs to may have ended the session
      if (isSelf && !list?.canManage) {
        await goto(Route.logout());
        return;
      }
      toastManager.primary($t('linked_accounts_removed'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_remove_linked_account'));
    }
    await refresh();
  };

  const handleTransfer = async ({ id }: UserOAuthIdentityResponseDto) => {
    const confirmed = await modalManager.showDialog({ prompt: $t('linked_accounts_make_owner_confirmation') });
    if (!confirmed) {
      return;
    }

    try {
      await (userId ? transferUserOAuthIdentityAdmin({ id: userId, identityId: id }) : transferMyOAuthIdentity({ id }));
      toastManager.primary($t('linked_accounts_owner_changed'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_change_linked_account_owner'));
    }
    await refresh();
  };

  const statusColors = {
    [UserOAuthIdentityStatus.Active]: 'success',
    [UserOAuthIdentityStatus.Pending]: 'warning',
    [UserOAuthIdentityStatus.Expired]: 'danger',
  } as const;

  const statusLabels = $derived({
    [UserOAuthIdentityStatus.Active]: $t('active'),
    [UserOAuthIdentityStatus.Pending]: $t('pending'),
    [UserOAuthIdentityStatus.Expired]: $t('expired'),
  });
</script>

{#if list}
  <div class="flex flex-col gap-4">
    {#if isAdmin && list.identities.length > 0}
      <Alert color="warning" size="small" title={$t('linked_accounts_admin_warning')} />
    {/if}

    {#each list.identities as identity (identity.id)}
      {@const isSelf = identity.id === list.currentIdentityId}
      <div class="flex flex-wrap items-center justify-between gap-2" data-testid="linked-account">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <Text class="break-all" fontWeight="medium">{identity.email || identity.name}</Text>
            {#if identity.role === UserOAuthIdentityRole.Owner}
              <Badge color="primary" size="tiny">{$t('owner')}</Badge>
            {/if}
            {#if identity.status !== UserOAuthIdentityStatus.Active}
              <Badge color={statusColors[identity.status]} size="tiny">{statusLabels[identity.status]}</Badge>
            {/if}
            {#if isSelf}
              <Badge color="secondary" size="tiny">{$t('you')}</Badge>
            {/if}
          </div>
          <Text color="muted" size="tiny">
            {#if identity.status !== UserOAuthIdentityStatus.Active && identity.inviteExpiresAt}
              {$t('expires_date', {
                values: { date: dateFormatter.formatDateTime(new Date(identity.inviteExpiresAt)) },
              })}
            {:else if identity.lastLoginAt}
              {$t('last_seen')}: {dateFormatter.formatDateTime(new Date(identity.lastLoginAt))}
            {/if}
          </Text>
        </div>

        <div class="flex gap-2">
          {#if list.canManage && identity.status !== UserOAuthIdentityStatus.Active}
            <Button shape="round" size="tiny" variant="ghost" onclick={() => handleRenew(identity)}>
              {$t('linked_accounts_renew')}
            </Button>
          {/if}
          {#if list.canManage && identity.status === UserOAuthIdentityStatus.Active && identity.role === UserOAuthIdentityRole.Member}
            <Button shape="round" size="tiny" variant="ghost" onclick={() => handleTransfer(identity)}>
              {$t('linked_accounts_make_owner')}
            </Button>
          {/if}
          {#if list.canManage || isSelf}
            <Button shape="round" size="tiny" variant="ghost" color="danger" onclick={() => handleRemove(identity)}>
              {$t('remove')}
            </Button>
          {/if}
        </div>
      </div>
    {:else}
      <Text color="muted" size="small">{$t('linked_accounts_empty')}</Text>
    {/each}

    {#if list.canManage && list.sharingEnabled}
      <form class="flex flex-col gap-2" onsubmit={handleInvite}>
        <Field label={$t('linked_accounts_invite')} description={$t('linked_accounts_invite_description')}>
          <Input type="email" bind:value={email} placeholder="name@gmail.com" />
        </Field>
        <div class="flex justify-end">
          <Button type="submit" shape="round" size="small" disabled={inviting || !email.trim()}>
            {$t('linked_accounts_invite')}
          </Button>
        </div>
      </form>
    {:else if list.canManage}
      <Text color="muted" size="tiny">{$t('linked_accounts_sharing_disabled')}</Text>
    {:else}
      <Text color="muted" size="tiny">{$t('linked_accounts_member_description')}</Text>
    {/if}
  </div>
{:else}
  <div class="flex place-content-center place-items-center">
    <LoadingSpinner />
  </div>
{/if}
