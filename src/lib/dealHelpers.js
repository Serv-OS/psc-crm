import { supabase } from './supabase';
import { FIRST_BUILD_STAGE } from './buildStages';

/**
 * When a deal moves to closed_won, auto-create an onboarding record
 * linked to the same company, copy associated locations, and write stage history.
 * Returns the new onboarding record if created, null otherwise.
 */
export async function handleClosedWon(dealId, profileId) {
  // Fetch the deal
  const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();
  if (!deal || deal.stage !== 'closed_won') return null;

  // Check if an onboarding already exists for this deal (prevent duplicates)
  const { data: existing } = await supabase.from('onboardings')
    .select('id').eq('deal_id', dealId).limit(1);
  if (existing?.length > 0) return existing[0];

  // Create the onboarding
  const { data: onboarding } = await supabase.from('onboardings').insert({
    company_id: deal.company_id,
    deal_id: dealId,
    owner_id: deal.owner_id,
    notes: `Auto-created from deal: ${deal.name}`,
  }).select().single();

  if (!onboarding) return null;

  // Write initial stage history for the onboarding
  await supabase.from('stage_history').insert({
    object_type: 'onboarding',
    object_id: onboarding.id,
    from_stage: null,
    to_stage: FIRST_BUILD_STAGE,
    changed_by: profileId,
  });

  // Copy location associations from the deal to the onboarding
  const { data: dealLocations } = await supabase.from('associations')
    .select('*')
    .eq('from_type', 'deal').eq('from_id', dealId).eq('to_type', 'location');

  if (dealLocations?.length > 0) {
    const locationAssocs = dealLocations.map(a => ({
      from_type: 'onboarding',
      from_id: onboarding.id,
      to_type: 'location',
      to_id: a.to_id,
      label: a.label || 'affected_location',
    }));
    await supabase.from('associations').insert(locationAssocs);
  }

  // Copy contact associations from the deal to the onboarding
  const { data: dealContacts } = await supabase.from('associations')
    .select('*')
    .eq('from_type', 'deal').eq('from_id', dealId).eq('to_type', 'contact');

  if (dealContacts?.length > 0) {
    const contactAssocs = dealContacts.map(a => ({
      from_type: 'onboarding',
      from_id: onboarding.id,
      to_type: 'contact',
      to_id: a.to_id,
      label: a.label,
    }));
    await supabase.from('associations').insert(contactAssocs);
  }

  return onboarding;
}
