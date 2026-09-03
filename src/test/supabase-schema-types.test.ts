import { describe, expectTypeOf, it } from 'vitest';
import type { Database } from '@/integrations/supabase/types';

type Public = Database['public'];
type Tables = Public['Tables'];
type Functions = Public['Functions'];

describe('migration-defined Supabase type contracts', () => {
  it('includes the runtime-control singleton aliases and cutover tables', () => {
    expectTypeOf<Tables['runtime_controls']['Row']>().toMatchTypeOf<{
      singleton_id: boolean;
      singleton_key: boolean;
    }>();
    expectTypeOf<Tables['runtime_activation_epochs']['Row']>().toEqualTypeOf<{
      activated_by: string | null;
      activation_key: string | null;
      created_at: string;
      epoch_id: number;
      t1_cutover_at: string;
      t2_activated_at: string;
    }>();
    expectTypeOf<Tables['delivery_cutover']['Row']>().toEqualTypeOf<{
      delivery_cutover_at: string;
      disposition: string;
      initialized_at: string;
      initialized_by: string | null;
      singleton_key: boolean;
    }>();
  });

  it('enforces write-shape contracts for generated and defaulted columns', () => {
    expectTypeOf<Tables['runtime_controls']['Insert']>().toEqualTypeOf<{
      dedupe_enabled?: boolean;
      environment?: string;
      posting_mode?: string;
      singleton_id?: boolean;
      singleton_key?: boolean;
      translation_enabled?: boolean;
      updated_at?: string;
      updated_by?: string | null;
    }>();
    expectTypeOf<Tables['runtime_activation_epochs']['Insert']>().toEqualTypeOf<{
      activated_by?: string | null;
      activation_key?: string | null;
      created_at?: string;
      epoch_id?: never;
      t1_cutover_at?: string;
      t2_activated_at?: string;
    }>();
    expectTypeOf<Tables['runtime_activation_epochs']['Update']>().toEqualTypeOf<{
      activated_by?: string | null;
      activation_key?: string | null;
      created_at?: string;
      epoch_id?: never;
      t1_cutover_at?: string;
      t2_activated_at?: string;
    }>();
  });

  it('matches the committed V2, cutover, and render RPC signatures', () => {
    expectTypeOf<Functions['activate_runtime_v2']['Args']>().toEqualTypeOf<{
      p_activation_key?: string;
      p_activated_by?: string;
    }>();
    expectTypeOf<Functions['runtime_v2_allows_lineage']['Args']>().toEqualTypeOf<{
      p_lineage_time: string;
      p_epoch_generation: number;
    }>();
    expectTypeOf<Functions['update_runtime_controls_v2']['Args']>().toEqualTypeOf<{
      p_dedupe_enabled: boolean;
      p_translation_enabled: boolean;
    }>();
    expectTypeOf<Functions['claim_telegram_delivery_v2']['Args']>().toEqualTypeOf<{
      p_delivery_key: string;
      p_subject_id: string;
      p_chat_id: string;
      p_lineage_time: string;
      p_epoch_generation: number;
      p_source?: string;
      p_claim_ttl_seconds?: number;
    }>();
    expectTypeOf<Functions['claim_telegram_delivery_unchecked']['Args']>().toEqualTypeOf<{
      p_delivery_key: string;
      p_subject_id: string;
      p_chat_id: string;
      p_source?: string;
      p_claim_ttl_seconds?: number;
    }>();
    expectTypeOf<Functions['lock_runtime_controls']['Args']>().toEqualTypeOf<never>();
    expectTypeOf<Functions['lock_runtime_controls']['Returns']>().toEqualTypeOf<undefined>();
    expectTypeOf<Functions['lock_runtime_v2_activation']['Args']>().toEqualTypeOf<never>();
    expectTypeOf<Functions['lock_runtime_v2_activation']['Returns']>().toEqualTypeOf<undefined>();
    expectTypeOf<Functions['claim_x_post_delivery_v2']['Args']>().toEqualTypeOf<{
      p_post_id: string;
      p_lineage_time: string;
      p_epoch_generation: number;
      p_source?: string;
      p_force_retry?: boolean;
      p_claim_ttl_seconds?: number;
    }>();
    expectTypeOf<Functions['release_x_post_delivery_for_retry']['Args']>().toEqualTypeOf<{
      p_claim_generation: number;
      p_claim_token: string;
      p_delivery_id: string;
      p_error?: string;
      p_media_bytes?: number;
      p_media_count?: number;
      p_media_kind?: string;
      p_next_retry_at?: string;
    }>();
    expectTypeOf<Functions['release_x_post_delivery_for_retry']['Returns']>().toEqualTypeOf<boolean>();
    expectTypeOf<Functions['claim_video_render_after']['Args']>().toEqualTypeOf<{
      p_queued_after: string;
      worker_id?: string;
    }>();
    expectTypeOf<Functions['claim_video_render_after']['Returns']>().toEqualTypeOf<
      Tables['video_renders']['Row'][]
    >();
    expectTypeOf<Functions['initialize_delivery_cutover']['Args']>().toEqualTypeOf<{
      p_initialized_by?: string;
    }>();
    expectTypeOf<Functions['get_delivery_cutover']['Args']>().toEqualTypeOf<never>();
    expectTypeOf<Functions['get_delivery_cutover']['Returns']>().toEqualTypeOf<string>();
    expectTypeOf<Functions['delivery_cutover_allows_post']['Args']>().toEqualTypeOf<{
      p_tweet_id: string;
    }>();
    expectTypeOf<Functions['delivery_cutover_allows_job']['Args']>().toEqualTypeOf<{
      p_created_at: string;
      p_tweet_id: string;
    }>();
    expectTypeOf<Functions['assert_delivery_cutover_post']['Args']>().toEqualTypeOf<{
      p_tweet_id: string;
    }>();
    expectTypeOf<Functions['update_runtime_control']['Returns']>().toMatchTypeOf<{
      singleton_key: boolean;
    }>();
    expectTypeOf<Functions['settle_delivery_cutover_blocked']['Args']>().toEqualTypeOf<{
      p_job_id: string;
      p_reason?: string;
    }>();
  });
});
