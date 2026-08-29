export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          display_name: string | null
          enabled: boolean
          handle: string
          id: string
          last_seen_item_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          handle: string
          id?: string
          last_seen_item_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          handle?: string
          id?: string
          last_seen_item_id?: string | null
        }
        Relationships: []
      }
      ai_call_ledger: {
        Row: {
          agent_name: string | null
          completion_tokens: number
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          endpoint: string | null
          error_message: string | null
          estimated_cost_usd: number | null
          foglamp_exported: boolean
          foglamp_skip_reason: string | null
          foglamp_span_estimate: number
          http_status: number | null
          id: string
          metadata: Json
          model: string | null
          operation_name: string
          prompt_tokens: number
          provider: string
          reasoning_tokens: number
          started_at: string
          status: string
          total_tokens: number
          trace_name: string
          workflow_run_key: string
        }
        Insert: {
          agent_name?: string | null
          completion_tokens?: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          endpoint?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          foglamp_exported?: boolean
          foglamp_skip_reason?: string | null
          foglamp_span_estimate?: number
          http_status?: number | null
          id?: string
          metadata?: Json
          model?: string | null
          operation_name: string
          prompt_tokens?: number
          provider?: string
          reasoning_tokens?: number
          started_at?: string
          status?: string
          total_tokens?: number
          trace_name: string
          workflow_run_key: string
        }
        Update: {
          agent_name?: string | null
          completion_tokens?: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          endpoint?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          foglamp_exported?: boolean
          foglamp_skip_reason?: string | null
          foglamp_span_estimate?: number
          http_status?: number | null
          id?: string
          metadata?: Json
          model?: string | null
          operation_name?: string
          prompt_tokens?: number
          provider?: string
          reasoning_tokens?: number
          started_at?: string
          status?: string
          total_tokens?: number
          trace_name?: string
          workflow_run_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_ledger_workflow_run_key_fkey"
            columns: ["workflow_run_key"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["run_key"]
          },
        ]
      }
      budget_ledger: {
        Row: {
          created_at: string
          estimated_cost_usd: number | null
          id: string
          metadata: Json
          period_key: string
          provider: string
          quantity: number
          source_id: string | null
          source_table: string | null
          unit: string
          workflow_run_key: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          metadata?: Json
          period_key: string
          provider: string
          quantity?: number
          source_id?: string | null
          source_table?: string | null
          unit: string
          workflow_run_key?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          metadata?: Json
          period_key?: string
          provider?: string
          quantity?: number
          source_id?: string | null
          source_table?: string | null
          unit?: string
          workflow_run_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_ledger_workflow_run_key_fkey"
            columns: ["workflow_run_key"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["run_key"]
          },
        ]
      }
      compatibility_usage_events: {
        Row: {
          action: string | null
          actor_id: string | null
          canonical_value: string | null
          created_at: string
          feature: string
          id: string
          legacy_value: string | null
          metadata: Json
          request_method: string | null
          request_path: string | null
          source: string
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          canonical_value?: string | null
          created_at?: string
          feature: string
          id?: string
          legacy_value?: string | null
          metadata?: Json
          request_method?: string | null
          request_path?: string | null
          source: string
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          canonical_value?: string | null
          created_at?: string
          feature?: string
          id?: string
          legacy_value?: string | null
          metadata?: Json
          request_method?: string | null
          request_path?: string | null
          source?: string
        }
        Relationships: []
      }
      dead_letter_jobs: {
        Row: {
          attempts: number | null
          created_at: string
          failed_at: string
          id: string
          last_error: string | null
          original_job_id: string | null
          payload: Json | null
          result_meta: Json | null
          source: string | null
          type: string
        }
        Insert: {
          attempts?: number | null
          created_at?: string
          failed_at?: string
          id?: string
          last_error?: string | null
          original_job_id?: string | null
          payload?: Json | null
          result_meta?: Json | null
          source?: string | null
          type: string
        }
        Update: {
          attempts?: number | null
          created_at?: string
          failed_at?: string
          id?: string
          last_error?: string | null
          original_job_id?: string | null
          payload?: Json | null
          result_meta?: Json | null
          source?: string | null
          type?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          attempts: number | null
          claim_expires_at: string | null
          claim_generation: number
          claim_last_error: string | null
          claim_source: string | null
          claim_started_at: string | null
          claim_state: string
          claim_token: string | null
          created_at: string
          delivery_key: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          posted_at: string | null
          provider_message_ids: string[] | null
          provider_started_at: string | null
          status: string | null
          subject_id: string
          subject_type: string | null
          target_chat: string | null
          telegram_chat_id: string | null
          telegram_message_ids: string[] | null
        }
        Insert: {
          attempts?: number | null
          claim_expires_at?: string | null
          claim_generation?: number
          claim_last_error?: string | null
          claim_source?: string | null
          claim_started_at?: string | null
          claim_state?: string
          claim_token?: string | null
          created_at?: string
          delivery_key?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          posted_at?: string | null
          provider_message_ids?: string[] | null
          provider_started_at?: string | null
          status?: string | null
          subject_id: string
          subject_type?: string | null
          target_chat?: string | null
          telegram_chat_id?: string | null
          telegram_message_ids?: string[] | null
        }
        Update: {
          attempts?: number | null
          claim_expires_at?: string | null
          claim_generation?: number
          claim_last_error?: string | null
          claim_source?: string | null
          claim_started_at?: string | null
          claim_state?: string
          claim_token?: string | null
          created_at?: string
          delivery_key?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          posted_at?: string | null
          provider_message_ids?: string[] | null
          provider_started_at?: string | null
          status?: string | null
          subject_id?: string
          subject_type?: string | null
          target_chat?: string | null
          telegram_chat_id?: string | null
          telegram_message_ids?: string[] | null
        }
        Relationships: []
      }
      delivery_cutover: {
        Row: {
          delivery_cutover_at: string
          disposition: string
          initialized_at: string
          initialized_by: string | null
          singleton_key: boolean
        }
        Insert: {
          delivery_cutover_at: string
          disposition?: string
          initialized_at?: string
          initialized_by?: string | null
          singleton_key?: boolean
        }
        Update: {
          delivery_cutover_at?: string
          disposition?: string
          initialized_at?: string
          initialized_by?: string | null
          singleton_key?: boolean
        }
        Relationships: []
      }
      digest_runs: {
        Row: {
          claim_expires_at: string | null
          claim_generation: number
          claim_token: string | null
          completed_at: string | null
          created_at: string
          delivery_checkpoint_at: string | null
          delivery_key: string
          delivery_state: string
          input_fingerprint: string
          last_error: string | null
          output_digest_id: string | null
          output_key: string | null
          output_persisted_at: string | null
          period_end: string
          period_start: string
          post_ids: string[]
          provider_started_at: string | null
          run_key: string
          state: string
          updated_at: string
        }
        Insert: {
          claim_expires_at?: string | null
          claim_generation?: number
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          delivery_checkpoint_at?: string | null
          delivery_key: string
          delivery_state?: string
          input_fingerprint: string
          last_error?: string | null
          output_digest_id?: string | null
          output_key?: string | null
          output_persisted_at?: string | null
          period_end: string
          period_start: string
          post_ids?: string[]
          provider_started_at?: string | null
          run_key: string
          state?: string
          updated_at?: string
        }
        Update: {
          claim_expires_at?: string | null
          claim_generation?: number
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          delivery_checkpoint_at?: string | null
          delivery_key?: string
          delivery_state?: string
          input_fingerprint?: string
          last_error?: string | null
          output_digest_id?: string | null
          output_key?: string | null
          output_persisted_at?: string | null
          period_end?: string
          period_start?: string
          post_ids?: string[]
          provider_started_at?: string | null
          run_key?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_runs_output_digest_id_fkey"
            columns: ["output_digest_id"]
            isOneToOne: false
            referencedRelation: "digests"
            referencedColumns: ["id"]
          },
        ]
      }
      digests: {
        Row: {
          created_at: string
          error: string | null
          formatted_tweets: Json | null
          id: string
          output_key: string | null
          period_end: string
          period_start: string
          post_ids: string[] | null
          run_key: string | null
          status: string
          summary_text: string | null
          twitter_tweet_ids: string[] | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          formatted_tweets?: Json | null
          id?: string
          output_key?: string | null
          period_end: string
          period_start: string
          post_ids?: string[] | null
          run_key?: string | null
          status?: string
          summary_text?: string | null
          twitter_tweet_ids?: string[] | null
        }
        Update: {
          created_at?: string
          error?: string | null
          formatted_tweets?: Json | null
          id?: string
          output_key?: string | null
          period_end?: string
          period_start?: string
          post_ids?: string[] | null
          run_key?: string | null
          status?: string
          summary_text?: string | null
          twitter_tweet_ids?: string[] | null
        }
        Relationships: []
      }
      enrichment_research_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          model: string | null
          post_id: string | null
          research: Json
          source_hash: string | null
          source_url: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          model?: string | null
          post_id?: string | null
          research: Json
          source_hash?: string | null
          source_url?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          model?: string | null
          post_id?: string | null
          research?: Json
          source_hash?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_research_cache_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      feedback_events: {
        Row: {
          action: string
          created_at: string
          id: string
          meta: Json | null
          polarity: number
          related_tweet_id: string | null
          source: string | null
          tweet_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          meta?: Json | null
          polarity?: number
          related_tweet_id?: string | null
          source?: string | null
          tweet_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          meta?: Json | null
          polarity?: number
          related_tweet_id?: string | null
          source?: string | null
          tweet_id?: string
        }
        Relationships: []
      }
      feeds: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          rss_url: string | null
          rssapp_feed_id: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          rss_url?: string | null
          rssapp_feed_id?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          rss_url?: string | null
          rssapp_feed_id?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number | null
          claim_expires_at: string | null
          claim_generation: number
          claim_started_at: string | null
          claim_state: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_run_at: string | null
          payload: Json | null
          priority: number | null
          provider_started_at: string | null
          result_meta: Json | null
          started_at: string | null
          status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          claim_expires_at?: string | null
          claim_generation?: number
          claim_started_at?: string | null
          claim_state?: string
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_run_at?: string | null
          payload?: Json | null
          priority?: number | null
          provider_started_at?: string | null
          result_meta?: Json | null
          started_at?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          claim_expires_at?: string | null
          claim_generation?: number
          claim_started_at?: string | null
          claim_state?: string
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_run_at?: string | null
          payload?: Json | null
          priority?: number | null
          provider_started_at?: string | null
          result_meta?: Json | null
          started_at?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      manual_video_intakes: {
        Row: {
          blocks_auto_delivery: boolean
          caption_draft: string | null
          caption_edited: string | null
          created_at: string
          created_by: string | null
          duplicate_override: boolean
          duplicate_override_reason: string | null
          id: string
          last_error: string | null
          posted_at: string | null
          posted_x_tweet_id: string | null
          safety_flags: Json
          selected_render_id: string | null
          source_handle: string | null
          source_url: string
          status: string
          tweet_id: string
          updated_at: string
        }
        Insert: {
          blocks_auto_delivery?: boolean
          caption_draft?: string | null
          caption_edited?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_override?: boolean
          duplicate_override_reason?: string | null
          id?: string
          last_error?: string | null
          posted_at?: string | null
          posted_x_tweet_id?: string | null
          safety_flags?: Json
          selected_render_id?: string | null
          source_handle?: string | null
          source_url: string
          status?: string
          tweet_id: string
          updated_at?: string
        }
        Update: {
          blocks_auto_delivery?: boolean
          caption_draft?: string | null
          caption_edited?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_override?: boolean
          duplicate_override_reason?: string | null
          id?: string
          last_error?: string | null
          posted_at?: string | null
          posted_x_tweet_id?: string | null
          safety_flags?: Json
          selected_render_id?: string | null
          source_handle?: string | null
          source_url?: string
          status?: string
          tweet_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_video_intakes_selected_render_id_fkey"
            columns: ["selected_render_id"]
            isOneToOne: false
            referencedRelation: "video_renders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_video_intakes_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      media: {
        Row: {
          created_at: string
          downloaded_at: string | null
          duration_ms: number | null
          file_size: number | null
          height: number | null
          id: string
          kind: string | null
          mime_type: string | null
          object_id: string | null
          ordering: number | null
          src_url: string | null
          src_url_hash: string | null
          storage_path: string | null
          tweet_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          downloaded_at?: string | null
          duration_ms?: number | null
          file_size?: number | null
          height?: number | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          object_id?: string | null
          ordering?: number | null
          src_url?: string | null
          src_url_hash?: string | null
          storage_path?: string | null
          tweet_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          downloaded_at?: string | null
          duration_ms?: number | null
          file_size?: number | null
          height?: number | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          object_id?: string | null
          ordering?: number | null
          src_url?: string | null
          src_url_hash?: string | null
          storage_path?: string | null
          tweet_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "media_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      media_objects: {
        Row: {
          bucket_id: string
          claim_expires_at: string | null
          claimed_at: string | null
          content_hash: string | null
          created_at: string
          deleted_at: string | null
          deletion_token: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          source: string | null
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          bucket_id?: string
          claim_expires_at?: string | null
          claimed_at?: string | null
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_token?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          source?: string | null
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          claim_expires_at?: string | null
          claimed_at?: string | null
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_token?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          source?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      moderation_events: {
        Row: {
          categories: Json | null
          created_at: string
          id: string
          reviewer_id: string | null
          subject_id: string
          subject_type: string | null
          verdict: string | null
        }
        Insert: {
          categories?: Json | null
          created_at?: string
          id?: string
          reviewer_id?: string | null
          subject_id: string
          subject_type?: string | null
          verdict?: string | null
        }
        Update: {
          categories?: Json | null
          created_at?: string
          id?: string
          reviewer_id?: string | null
          subject_id?: string
          subject_type?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      pipeline_events: {
        Row: {
          actor: string | null
          created_at: string
          ended_at: string | null
          error: string | null
          id: string
          meta: Json | null
          started_at: string | null
          status: string
          step: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          meta?: Json | null
          started_at?: string | null
          status: string
          step: string
          subject_id: string
          subject_type: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          meta?: Json | null
          started_at?: string | null
          status?: string
          step?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: []
      }
      post_enrichments: {
        Row: {
          aggregator_risk_score: number | null
          ai_voice_risk_score: number | null
          algorithm_signal_scores: Json
          approved_at: string | null
          created_at: string
          creator_angle: string | null
          critic_output: Json
          enrichment_review_reason: string | null
          feedback_at: string | null
          feedback_label: string | null
          feedback_note: string | null
          final_x_text: string | null
          format_used: string | null
          id: string
          model: string
          monetization_risk_flags: string[]
          post_id: string
          rejected_at: string | null
          source_context: Json | null
          status: string
          thread_continuation: string | null
          version: string
          why_it_matters: string | null
        }
        Insert: {
          aggregator_risk_score?: number | null
          ai_voice_risk_score?: number | null
          algorithm_signal_scores?: Json
          approved_at?: string | null
          created_at?: string
          creator_angle?: string | null
          critic_output?: Json
          enrichment_review_reason?: string | null
          feedback_at?: string | null
          feedback_label?: string | null
          feedback_note?: string | null
          final_x_text?: string | null
          format_used?: string | null
          id?: string
          model: string
          monetization_risk_flags?: string[]
          post_id: string
          rejected_at?: string | null
          source_context?: Json | null
          status?: string
          thread_continuation?: string | null
          version?: string
          why_it_matters?: string | null
        }
        Update: {
          aggregator_risk_score?: number | null
          ai_voice_risk_score?: number | null
          algorithm_signal_scores?: Json
          approved_at?: string | null
          created_at?: string
          creator_angle?: string | null
          critic_output?: Json
          enrichment_review_reason?: string | null
          feedback_at?: string | null
          feedback_label?: string | null
          feedback_note?: string | null
          final_x_text?: string | null
          format_used?: string | null
          id?: string
          model?: string
          monetization_risk_flags?: string[]
          post_id?: string
          rejected_at?: string | null
          source_context?: Json | null
          status?: string
          thread_continuation?: string | null
          version?: string
          why_it_matters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_enrichments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      posts: {
        Row: {
          account_id: string
          aggregator_risk_score: number | null
          ai_voice_risk_score: number | null
          algorithm_signal_scores: Json | null
          audience_class: string | null
          audience_confidence: number | null
          audience_reason: string | null
          author_handle: string | null
          background_context: Json | null
          base_score: number | null
          commentary_hook: string | null
          commentary_question: string | null
          composed_post_text: string | null
          created_at: string
          creator_angle: string | null
          decision_reason: string | null
          dedupe_checked_at: string | null
          dedupe_confidence: number | null
          dedupe_method: string | null
          dedupe_new_facts: string[] | null
          dedupe_reason: string | null
          dedupe_status: string | null
          delivery_decision: string | null
          dup_of_tweet_id: string | null
          dup_similarity: number | null
          editorial_commentary: string | null
          enrich_duration_ms: number | null
          enrich_model: string | null
          enrich_status: string | null
          enrich_tokens: number | null
          enrichment_review_reason: string | null
          enrichment_version: string | null
          feedback_locked: boolean
          final_score: number | null
          final_x_text: string | null
          global_exception_class: string | null
          has_media: boolean | null
          humanized_commentary: string | null
          hydrated_at: string | null
          hydration_source: string | null
          importance_reasoning: string | null
          importance_score: number | null
          importance_tags: string[] | null
          is_truncated: boolean
          lang_original: string | null
          learned_delta: number | null
          learned_score: number | null
          learning_confidence: Json | null
          monetization_risk_flags: string[] | null
          narrative_callback: string | null
          narrative_ref_post_id: string | null
          post_format_hint: string | null
          score_axes: Json | null
          score_breakdown: Json | null
          score_review_status: string | null
          scoring_profile_id: string | null
          scoring_version: string | null
          source_context: Json | null
          story_cluster_id: string | null
          text_original: string | null
          text_translated: string | null
          thread_continuation: string | null
          translated_at: string | null
          translation_duration_ms: number | null
          translation_job_id: string | null
          translation_model: string | null
          translation_tokens: number | null
          tweet_id: string
          tweeted_at: string | null
          url: string | null
          why_it_matters: string | null
          x_gate_score: number | null
        }
        Insert: {
          account_id: string
          aggregator_risk_score?: number | null
          ai_voice_risk_score?: number | null
          algorithm_signal_scores?: Json | null
          audience_class?: string | null
          audience_confidence?: number | null
          audience_reason?: string | null
          author_handle?: string | null
          background_context?: Json | null
          base_score?: number | null
          commentary_hook?: string | null
          commentary_question?: string | null
          composed_post_text?: string | null
          created_at?: string
          creator_angle?: string | null
          decision_reason?: string | null
          dedupe_checked_at?: string | null
          dedupe_confidence?: number | null
          dedupe_method?: string | null
          dedupe_new_facts?: string[] | null
          dedupe_reason?: string | null
          dedupe_status?: string | null
          delivery_decision?: string | null
          dup_of_tweet_id?: string | null
          dup_similarity?: number | null
          editorial_commentary?: string | null
          enrich_duration_ms?: number | null
          enrich_model?: string | null
          enrich_status?: string | null
          enrich_tokens?: number | null
          enrichment_review_reason?: string | null
          enrichment_version?: string | null
          feedback_locked?: boolean
          final_score?: number | null
          final_x_text?: string | null
          global_exception_class?: string | null
          has_media?: boolean | null
          humanized_commentary?: string | null
          hydrated_at?: string | null
          hydration_source?: string | null
          importance_reasoning?: string | null
          importance_score?: number | null
          importance_tags?: string[] | null
          is_truncated?: boolean
          lang_original?: string | null
          learned_delta?: number | null
          learned_score?: number | null
          learning_confidence?: Json | null
          monetization_risk_flags?: string[] | null
          narrative_callback?: string | null
          narrative_ref_post_id?: string | null
          post_format_hint?: string | null
          score_axes?: Json | null
          score_breakdown?: Json | null
          score_review_status?: string | null
          scoring_profile_id?: string | null
          scoring_version?: string | null
          source_context?: Json | null
          story_cluster_id?: string | null
          text_original?: string | null
          text_translated?: string | null
          thread_continuation?: string | null
          translated_at?: string | null
          translation_duration_ms?: number | null
          translation_job_id?: string | null
          translation_model?: string | null
          translation_tokens?: number | null
          tweet_id: string
          tweeted_at?: string | null
          url?: string | null
          why_it_matters?: string | null
          x_gate_score?: number | null
        }
        Update: {
          account_id?: string
          aggregator_risk_score?: number | null
          ai_voice_risk_score?: number | null
          algorithm_signal_scores?: Json | null
          audience_class?: string | null
          audience_confidence?: number | null
          audience_reason?: string | null
          author_handle?: string | null
          background_context?: Json | null
          base_score?: number | null
          commentary_hook?: string | null
          commentary_question?: string | null
          composed_post_text?: string | null
          created_at?: string
          creator_angle?: string | null
          decision_reason?: string | null
          dedupe_checked_at?: string | null
          dedupe_confidence?: number | null
          dedupe_method?: string | null
          dedupe_new_facts?: string[] | null
          dedupe_reason?: string | null
          dedupe_status?: string | null
          delivery_decision?: string | null
          dup_of_tweet_id?: string | null
          dup_similarity?: number | null
          editorial_commentary?: string | null
          enrich_duration_ms?: number | null
          enrich_model?: string | null
          enrich_status?: string | null
          enrich_tokens?: number | null
          enrichment_review_reason?: string | null
          enrichment_version?: string | null
          feedback_locked?: boolean
          final_score?: number | null
          final_x_text?: string | null
          global_exception_class?: string | null
          has_media?: boolean | null
          humanized_commentary?: string | null
          hydrated_at?: string | null
          hydration_source?: string | null
          importance_reasoning?: string | null
          importance_score?: number | null
          importance_tags?: string[] | null
          is_truncated?: boolean
          lang_original?: string | null
          learned_delta?: number | null
          learned_score?: number | null
          learning_confidence?: Json | null
          monetization_risk_flags?: string[] | null
          narrative_callback?: string | null
          narrative_ref_post_id?: string | null
          post_format_hint?: string | null
          score_axes?: Json | null
          score_breakdown?: Json | null
          score_review_status?: string | null
          scoring_profile_id?: string | null
          scoring_version?: string | null
          source_context?: Json | null
          story_cluster_id?: string | null
          text_original?: string | null
          text_translated?: string | null
          thread_continuation?: string | null
          translated_at?: string | null
          translation_duration_ms?: number | null
          translation_job_id?: string | null
          translation_model?: string | null
          translation_tokens?: number | null
          tweet_id?: string
          tweeted_at?: string | null
          url?: string | null
          why_it_matters?: string | null
          x_gate_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_narrative_ref_post_id_fkey"
            columns: ["narrative_ref_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      queue_reconcile_runs: {
        Row: {
          expired_leases_released: number
          id: string
          missing_dedupes_created: number
          missing_deliveries_created: number
          missing_hydrations_created: number
          missing_media_created: number
          missing_translates_created: number
          ran_at: string
          result: Json
          stale_running_released: number
        }
        Insert: {
          expired_leases_released?: number
          id?: string
          missing_dedupes_created?: number
          missing_deliveries_created?: number
          missing_hydrations_created?: number
          missing_media_created?: number
          missing_translates_created?: number
          ran_at?: string
          result?: Json
          stale_running_released?: number
        }
        Update: {
          expired_leases_released?: number
          id?: string
          missing_dedupes_created?: number
          missing_deliveries_created?: number
          missing_hydrations_created?: number
          missing_media_created?: number
          missing_translates_created?: number
          ran_at?: string
          result?: Json
          stale_running_released?: number
        }
        Relationships: []
      }
      scoring_evaluations: {
        Row: {
          accuracy: number | null
          ambiguous_count: number
          created_at: string
          example_count: number
          false_negative_count: number
          false_positive_count: number
          id: string
          model: string
          profile_id: string
          results: Json
          scoring_version: string
          summary: Json
        }
        Insert: {
          accuracy?: number | null
          ambiguous_count?: number
          created_at?: string
          example_count?: number
          false_negative_count?: number
          false_positive_count?: number
          id?: string
          model: string
          profile_id: string
          results?: Json
          scoring_version: string
          summary?: Json
        }
        Update: {
          accuracy?: number | null
          ambiguous_count?: number
          created_at?: string
          example_count?: number
          false_negative_count?: number
          false_positive_count?: number
          id?: string
          model?: string
          profile_id?: string
          results?: Json
          scoring_version?: string
          summary?: Json
        }
        Relationships: []
      }
      scoring_examples: {
        Row: {
          author_handle: string | null
          created_at: string
          created_by: string | null
          expected_audience_class: string
          expected_decision: string
          expected_global_exception_class: string | null
          expected_score: number | null
          id: string
          note: string | null
          profile_id: string
          source: string
          text_original: string
          tweet_id: string | null
        }
        Insert: {
          author_handle?: string | null
          created_at?: string
          created_by?: string | null
          expected_audience_class: string
          expected_decision: string
          expected_global_exception_class?: string | null
          expected_score?: number | null
          id?: string
          note?: string | null
          profile_id: string
          source?: string
          text_original: string
          tweet_id?: string | null
        }
        Update: {
          author_handle?: string | null
          created_at?: string
          created_by?: string | null
          expected_audience_class?: string
          expected_decision?: string
          expected_global_exception_class?: string | null
          expected_score?: number | null
          id?: string
          note?: string | null
          profile_id?: string
          source?: string
          text_original?: string
          tweet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_examples_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      story_pair_blocklist: {
        Row: {
          created_at: string
          reason: string | null
          tweet_a: string
          tweet_b: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          tweet_a: string
          tweet_b: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          tweet_a?: string
          tweet_b?: string
        }
        Relationships: []
      }
      story_signatures: {
        Row: {
          coverage_count: number
          created_at: string
          embedding: string | null
          normalized_text: string | null
          simhash: number | null
          story_cluster_id: string
          tweet_id: string
        }
        Insert: {
          coverage_count?: number
          created_at?: string
          embedding?: string | null
          normalized_text?: string | null
          simhash?: number | null
          story_cluster_id?: string
          tweet_id: string
        }
        Update: {
          coverage_count?: number
          created_at?: string
          embedding?: string | null
          normalized_text?: string | null
          simhash?: number | null
          story_cluster_id?: string
          tweet_id?: string
        }
        Relationships: []
      }
      telegram_channel_stats: {
        Row: {
          admin_count: number | null
          chat_id: string
          created_at: string | null
          description: string | null
          has_protected_content: boolean | null
          id: string
          invite_link: string | null
          is_verified: boolean | null
          member_count: number
          snapshot_at: string | null
          title: string | null
          username: string | null
        }
        Insert: {
          admin_count?: number | null
          chat_id: string
          created_at?: string | null
          description?: string | null
          has_protected_content?: boolean | null
          id?: string
          invite_link?: string | null
          is_verified?: boolean | null
          member_count: number
          snapshot_at?: string | null
          title?: string | null
          username?: string | null
        }
        Update: {
          admin_count?: number | null
          chat_id?: string
          created_at?: string | null
          description?: string | null
          has_protected_content?: boolean | null
          id?: string
          invite_link?: string | null
          is_verified?: boolean | null
          member_count?: number
          snapshot_at?: string | null
          title?: string | null
          username?: string | null
        }
        Relationships: []
      }
      telegram_daily_stats: {
        Row: {
          avg_delivery_time_ms: number | null
          chat_id: string
          created_at: string | null
          date: string
          ending_members: number | null
          id: string
          joined_count: number | null
          left_count: number | null
          messages_failed: number | null
          messages_sent: number | null
          starting_members: number | null
          total_media_sent: number | null
        }
        Insert: {
          avg_delivery_time_ms?: number | null
          chat_id: string
          created_at?: string | null
          date: string
          ending_members?: number | null
          id?: string
          joined_count?: number | null
          left_count?: number | null
          messages_failed?: number | null
          messages_sent?: number | null
          starting_members?: number | null
          total_media_sent?: number | null
        }
        Update: {
          avg_delivery_time_ms?: number | null
          chat_id?: string
          created_at?: string | null
          date?: string
          ending_members?: number | null
          id?: string
          joined_count?: number | null
          left_count?: number | null
          messages_failed?: number | null
          messages_sent?: number | null
          starting_members?: number | null
          total_media_sent?: number | null
        }
        Relationships: []
      }
      telegram_member_events: {
        Row: {
          chat_id: string
          created_at: string | null
          event_data: Json | null
          event_type: string
          first_name: string | null
          id: string
          is_bot: boolean | null
          is_premium: boolean | null
          last_name: string | null
          occurred_at: string | null
          user_id: number
          username: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          first_name?: string | null
          id?: string
          is_bot?: boolean | null
          is_premium?: boolean | null
          last_name?: string | null
          occurred_at?: string | null
          user_id: number
          username?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          first_name?: string | null
          id?: string
          is_bot?: boolean | null
          is_premium?: boolean | null
          last_name?: string | null
          occurred_at?: string | null
          user_id?: number
          username?: string | null
        }
        Relationships: []
      }
      telegram_message_analytics: {
        Row: {
          chat_id: string
          created_at: string | null
          delivery_status: string
          error_code: string | null
          error_message: string | null
          has_media: boolean | null
          id: string
          media_count: number | null
          post_id: string | null
          response_time_ms: number | null
          retry_count: number | null
          sent_at: string | null
          telegram_message_id: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string | null
          delivery_status: string
          error_code?: string | null
          error_message?: string | null
          has_media?: boolean | null
          id?: string
          media_count?: number | null
          post_id?: string | null
          response_time_ms?: number | null
          retry_count?: number | null
          sent_at?: string | null
          telegram_message_id?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string | null
          delivery_status?: string
          error_code?: string | null
          error_message?: string | null
          has_media?: boolean | null
          id?: string
          media_count?: number | null
          post_id?: string | null
          response_time_ms?: number | null
          retry_count?: number | null
          sent_at?: string | null
          telegram_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_message_analytics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      threads: {
        Row: {
          account_id: string
          confidence: number | null
          created_at: string
          id: string
          tweet_ids: string[] | null
        }
        Insert: {
          account_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          tweet_ids?: string[] | null
        }
        Update: {
          account_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          tweet_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "threads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_activation_epochs: {
        Row: {
          activated_by: string | null
          activation_key: string | null
          created_at: string
          epoch_id: number
          t1_cutover_at: string
          t2_activated_at: string
        }
        Insert: {
          activated_by?: string | null
          activation_key?: string | null
          created_at?: string
          epoch_id?: never
          t1_cutover_at?: string
          t2_activated_at?: string
        }
        Update: {
          activated_by?: string | null
          activation_key?: string | null
          created_at?: string
          epoch_id?: never
          t1_cutover_at?: string
          t2_activated_at?: string
        }
        Relationships: []
      }
      runtime_controls: {
        Row: {
          dedupe_enabled: boolean
          environment: string
          posting_mode: string
          singleton_id: boolean
          singleton_key: boolean
          translation_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          dedupe_enabled?: boolean
          environment?: string
          posting_mode?: string
          singleton_id?: boolean
          singleton_key?: boolean
          translation_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          dedupe_enabled?: boolean
          environment?: string
          posting_mode?: string
          singleton_id?: boolean
          singleton_key?: boolean
          translation_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_render_feedback: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          metadata: Json
          note: string | null
          render_id: string
          tweet_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          metadata?: Json
          note?: string | null
          render_id: string
          tweet_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          metadata?: Json
          note?: string | null
          render_id?: string
          tweet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_render_feedback_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "video_renders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_render_feedback_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      video_renderer_heartbeats: {
        Row: {
          created_at: string
          failed: number
          last_error: string | null
          last_seen_at: string
          metadata: Json
          processed: number
          render_version: string | null
          renderer_id: string
          running: number
          status: string
          updated_at: string
          version: string | null
        }
        Insert: {
          created_at?: string
          failed?: number
          last_error?: string | null
          last_seen_at?: string
          metadata?: Json
          processed?: number
          render_version?: string | null
          renderer_id: string
          running?: number
          status?: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          created_at?: string
          failed?: number
          last_error?: string | null
          last_seen_at?: string
          metadata?: Json
          processed?: number
          render_version?: string | null
          renderer_id?: string
          running?: number
          status?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      video_renders: {
        Row: {
          ass_subtitles: string | null
          attempts: number
          block_reason: string | null
          blocked_at: string | null
          claim_generation: number
          claim_token: string | null
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          expires_at: string | null
          failed_at: string | null
          failure_policy: string
          height: number | null
          id: string
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          metrics: Json
          original_srt: string | null
          output_file_size: number | null
          output_mime_type: string | null
          output_storage_path: string | null
          persian_srt: string | null
          posted_at: string | null
          preflight: Json
          queued_at: string
          render_revision: number
          render_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_language: string | null
          source_media_id: string
          started_at: string | null
          status: string
          target_language: string | null
          translated_srt: string | null
          tweet_id: string
          updated_at: string
          width: number | null
        }
        Insert: {
          ass_subtitles?: string | null
          attempts?: number
          block_reason?: string | null
          blocked_at?: string | null
          claim_generation?: number
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          expires_at?: string | null
          failed_at?: string | null
          failure_policy?: string
          height?: number | null
          id?: string
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          metrics?: Json
          original_srt?: string | null
          output_file_size?: number | null
          output_mime_type?: string | null
          output_storage_path?: string | null
          persian_srt?: string | null
          posted_at?: string | null
          preflight?: Json
          queued_at?: string
          render_revision?: number
          render_version?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_language?: string | null
          source_media_id: string
          started_at?: string | null
          status?: string
          target_language?: string | null
          translated_srt?: string | null
          tweet_id: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          ass_subtitles?: string | null
          attempts?: number
          block_reason?: string | null
          blocked_at?: string | null
          claim_generation?: number
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          expires_at?: string | null
          failed_at?: string | null
          failure_policy?: string
          height?: number | null
          id?: string
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          metrics?: Json
          original_srt?: string | null
          output_file_size?: number | null
          output_mime_type?: string | null
          output_storage_path?: string | null
          persian_srt?: string | null
          posted_at?: string | null
          preflight?: Json
          queued_at?: string
          render_revision?: number
          render_version?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_language?: string | null
          source_media_id?: string
          started_at?: string | null
          status?: string
          target_language?: string | null
          translated_srt?: string | null
          tweet_id?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_renders_source_media_id_fkey"
            columns: ["source_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_renders_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      webhook_receipts: {
        Row: {
          auth_mode: string
          claim_expires_at: string | null
          claim_generation: number
          claim_state: string
          claim_token: string | null
          completed_at: string | null
          feed_id: string
          item_outcomes: Json
          last_error: string | null
          provider_started_at: string | null
          receipt_key: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          auth_mode: string
          claim_expires_at?: string | null
          claim_generation?: number
          claim_state?: string
          claim_token?: string | null
          completed_at?: string | null
          feed_id: string
          item_outcomes?: Json
          last_error?: string | null
          provider_started_at?: string | null
          receipt_key: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          auth_mode?: string
          claim_expires_at?: string | null
          claim_generation?: number
          claim_state?: string
          claim_token?: string | null
          completed_at?: string | null
          feed_id?: string
          item_outcomes?: Json
          last_error?: string | null
          provider_started_at?: string | null
          receipt_key?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_runs: {
        Row: {
          created_at: string
          ended_at: string | null
          foglamp_workflow_run_id: string | null
          id: string
          job_id: string | null
          last_error: string | null
          metadata: Json
          root_trace_id: string | null
          run_key: string
          source: string | null
          source_function: string | null
          started_at: string
          status: string
          subject_id: string | null
          subject_type: string | null
          tweet_id: string | null
          updated_at: string
          workflow_name: string
          workflow_run_id: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          foglamp_workflow_run_id?: string | null
          id?: string
          job_id?: string | null
          last_error?: string | null
          metadata?: Json
          root_trace_id?: string | null
          run_key: string
          source?: string | null
          source_function?: string | null
          started_at?: string
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tweet_id?: string | null
          updated_at?: string
          workflow_name: string
          workflow_run_id?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          foglamp_workflow_run_id?: string | null
          id?: string
          job_id?: string | null
          last_error?: string | null
          metadata?: Json
          root_trace_id?: string | null
          run_key?: string
          source?: string | null
          source_function?: string | null
          started_at?: string
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tweet_id?: string | null
          updated_at?: string
          workflow_name?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
      }
      x_api_events: {
        Row: {
          created_at: string
          endpoint: string
          error: string | null
          estimated_billable_unit: string | null
          http_status: number | null
          id: string
          metadata: Json
          method: string
          ok: boolean
          rate_limit_limit: number | null
          rate_limit_remaining: number | null
          rate_limit_reset_at: string | null
          request_counted: boolean
          source: string
          source_action: string
          tweet_id: string | null
          x_user_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint: string
          error?: string | null
          estimated_billable_unit?: string | null
          http_status?: number | null
          id?: string
          metadata?: Json
          method?: string
          ok?: boolean
          rate_limit_limit?: number | null
          rate_limit_remaining?: number | null
          rate_limit_reset_at?: string | null
          request_counted?: boolean
          source: string
          source_action: string
          tweet_id?: string | null
          x_user_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint?: string
          error?: string | null
          estimated_billable_unit?: string | null
          http_status?: number | null
          id?: string
          metadata?: Json
          method?: string
          ok?: boolean
          rate_limit_limit?: number | null
          rate_limit_remaining?: number | null
          rate_limit_reset_at?: string | null
          request_counted?: boolean
          source?: string
          source_action?: string
          tweet_id?: string | null
          x_user_id?: string | null
        }
        Relationships: []
      }
      x_deliveries: {
        Row: {
          api_response: Json | null
          attempts: number
          claim_expires_at: string | null
          claim_generation: number
          claim_release_reason: string | null
          claim_released_at: string | null
          claim_source: string | null
          claim_started_at: string | null
          claim_state: string
          claim_token: string | null
          created_at: string
          id: string
          last_claim_error: string | null
          last_error: string | null
          latency_ms: number | null
          media_bytes: number
          media_count: number
          media_kind: string | null
          next_retry_at: string | null
          post_id: string
          posted_at: string | null
          provider_started_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
          x_tweet_id: string | null
        }
        Insert: {
          api_response?: Json | null
          attempts?: number
          claim_expires_at?: string | null
          claim_generation?: number
          claim_release_reason?: string | null
          claim_released_at?: string | null
          claim_source?: string | null
          claim_started_at?: string | null
          claim_state?: string
          claim_token?: string | null
          created_at?: string
          id?: string
          last_claim_error?: string | null
          last_error?: string | null
          latency_ms?: number | null
          media_bytes?: number
          media_count?: number
          media_kind?: string | null
          next_retry_at?: string | null
          post_id: string
          posted_at?: string | null
          provider_started_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          x_tweet_id?: string | null
        }
        Update: {
          api_response?: Json | null
          attempts?: number
          claim_expires_at?: string | null
          claim_generation?: number
          claim_release_reason?: string | null
          claim_released_at?: string | null
          claim_source?: string | null
          claim_started_at?: string | null
          claim_state?: string
          claim_token?: string | null
          created_at?: string
          id?: string
          last_claim_error?: string | null
          last_error?: string | null
          latency_ms?: number | null
          media_bytes?: number
          media_count?: number
          media_kind?: string | null
          next_retry_at?: string | null
          post_id?: string
          posted_at?: string | null
          provider_started_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          x_tweet_id?: string | null
        }
        Relationships: []
      }
      x_follower_changes: {
        Row: {
          change_type: string
          created_at: string
          curr_snapshot_id: string | null
          detected_at: string
          id: string
          name: string | null
          prev_snapshot_id: string | null
          profile_image_url: string | null
          reviewed: boolean
          user_id: string
          username: string | null
        }
        Insert: {
          change_type: string
          created_at?: string
          curr_snapshot_id?: string | null
          detected_at?: string
          id?: string
          name?: string | null
          prev_snapshot_id?: string | null
          profile_image_url?: string | null
          reviewed?: boolean
          user_id: string
          username?: string | null
        }
        Update: {
          change_type?: string
          created_at?: string
          curr_snapshot_id?: string | null
          detected_at?: string
          id?: string
          name?: string | null
          prev_snapshot_id?: string | null
          profile_image_url?: string | null
          reviewed?: boolean
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "x_follower_changes_curr_snapshot_id_fkey"
            columns: ["curr_snapshot_id"]
            isOneToOne: false
            referencedRelation: "x_follower_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x_follower_changes_prev_snapshot_id_fkey"
            columns: ["prev_snapshot_id"]
            isOneToOne: false
            referencedRelation: "x_follower_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      x_follower_snapshots: {
        Row: {
          api_calls_used: number
          created_at: string
          error: string | null
          follower_count: number
          follower_ids: string[]
          following_count: number
          following_ids: string[]
          id: string
          next_token: string | null
          pages_fetched: number
          status: string
          taken_at: string
          trigger: string
        }
        Insert: {
          api_calls_used?: number
          created_at?: string
          error?: string | null
          follower_count?: number
          follower_ids?: string[]
          following_count?: number
          following_ids?: string[]
          id?: string
          next_token?: string | null
          pages_fetched?: number
          status?: string
          taken_at?: string
          trigger?: string
        }
        Update: {
          api_calls_used?: number
          created_at?: string
          error?: string | null
          follower_count?: number
          follower_ids?: string[]
          following_count?: number
          following_ids?: string[]
          id?: string
          next_token?: string | null
          pages_fetched?: number
          status?: string
          taken_at?: string
          trigger?: string
        }
        Relationships: []
      }
      x_followers_cache: {
        Row: {
          first_seen_at: string
          last_seen_at: string
          name: string | null
          profile_image_url: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          first_seen_at?: string
          last_seen_at?: string
          name?: string | null
          profile_image_url?: string | null
          user_id: string
          username?: string | null
        }
        Update: {
          first_seen_at?: string
          last_seen_at?: string
          name?: string | null
          profile_image_url?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      x_non_followback_reviews: {
        Row: {
          created_at: string
          first_opened_at: string | null
          last_opened_at: string | null
          name: string | null
          notes: string | null
          opened_count: number
          profile_image_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          first_opened_at?: string | null
          last_opened_at?: string | null
          name?: string | null
          notes?: string | null
          opened_count?: number
          profile_image_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          first_opened_at?: string | null
          last_opened_at?: string | null
          name?: string | null
          notes?: string | null
          opened_count?: number
          profile_image_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      telegram_channel_current: {
        Row: {
          admin_count: number | null
          chat_id: string | null
          member_count: number | null
          snapshot_at: string | null
          title: string | null
          username: string | null
        }
        Insert: {
          admin_count?: number | null
          chat_id?: string | null
          member_count?: number | null
          snapshot_at?: string | null
          title?: string | null
          username?: string | null
        }
        Update: {
          admin_count?: number | null
          chat_id?: string | null
          member_count?: number | null
          snapshot_at?: string | null
          title?: string | null
          username?: string | null
        }
        Relationships: []
      }
      telegram_member_growth: {
        Row: {
          chat_id: string | null
          cumulative_growth: number | null
          date: string | null
          joined_count: number | null
          left_count: number | null
          net_change: number | null
        }
        Relationships: []
      }
      telegram_message_performance: {
        Row: {
          avg_response_time: number | null
          date: string | null
          failed: number | null
          messages_with_media: number | null
          successful: number | null
          total_messages: number | null
        }
        Relationships: []
      }
      x_deliveries_safe: {
        Row: {
          attempts: number | null
          created_at: string | null
          id: string | null
          last_error: string | null
          latency_ms: number | null
          media_bytes: number | null
          media_count: number | null
          media_kind: string | null
          post_id: string | null
          posted_at: string | null
          skip_reason: string | null
          status: string | null
          updated_at: string | null
          x_tweet_id: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          id?: string | null
          last_error?: string | null
          latency_ms?: number | null
          media_bytes?: number | null
          media_count?: number | null
          media_kind?: string | null
          post_id?: string | null
          posted_at?: string | null
          skip_reason?: string | null
          status?: string | null
          updated_at?: string | null
          x_tweet_id?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          id?: string | null
          last_error?: string | null
          latency_ms?: number | null
          media_bytes?: number | null
          media_count?: number | null
          media_kind?: string | null
          post_id?: string | null
          posted_at?: string | null
          skip_reason?: string | null
          status?: string | null
          updated_at?: string | null
          x_tweet_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cron_internal_headers: { Args: never; Returns: Json }
      _media_object_eligible: {
        Args: { p_object_id: string; p_v_bucket: string; p_v_days: number }
        Returns: boolean
      }
      _video_render_queue_delivery: {
        Args: { p_source?: string; p_tweet_id: string }
        Returns: boolean
      }
      _video_render_should_release: {
        Args: { p_tweet_id: string }
        Returns: boolean
      }
      activate_runtime_v2: {
        Args: { p_activation_key?: string; p_activated_by?: string }
        Returns: string
      }
      audit_duplicate_candidates: {
        Args: {
          candidate_min_similarity?: number
          match_limit?: number
          window_hours?: number
        }
        Returns: {
          a_author_handle: string
          a_created_at: string
          a_dedupe_status: string
          a_delivery_decision: string
          a_dup_of_tweet_id: string
          a_final_score: number
          a_telegram_status: string
          a_text: string
          a_tweet_id: string
          a_x_status: string
          b_author_handle: string
          b_created_at: string
          b_dedupe_status: string
          b_delivery_decision: string
          b_dup_of_tweet_id: string
          b_final_score: number
          b_telegram_status: string
          b_text: string
          b_tweet_id: string
          b_x_status: string
          proposed_reason: string
          proposed_status: string
          similarity: number
        }[]
      }
      block_video_render: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_metrics?: Json
          p_preflight?: Json
          p_reason: string
          p_render_id: string
          p_worker_id: string
        }
        Returns: Json
      }
      bump_coverage_count: { Args: { p_tweet_id: string }; Returns: undefined }
      calculate_growth_rate: {
        Args: { p_chat_id: string; p_days?: number }
        Returns: {
          growth_rate: number
          net_growth: number
          total_joined: number
          total_left: number
        }[]
      }
      checkpoint_digest_delivery_disabled: {
        Args: { p_input_fingerprint: string; p_run_key: string }
        Returns: boolean
      }
      claim_jobs: {
        Args: { batch_size?: number; job_types?: string[]; worker_id?: string }
        Returns: {
          attempts: number | null
          claim_expires_at: string | null
          claim_generation: number
          claim_started_at: string | null
          claim_state: string
          claim_token: string | null
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_run_at: string | null
          payload: Json | null
          priority: number | null
          provider_started_at: string | null
          result_meta: Json | null
          started_at: string | null
          status: string | null
          type: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_telegram_delivery: {
        Args: {
          p_chat_id: string
          p_claim_ttl_seconds?: number
          p_delivery_key: string
          p_source?: string
          p_subject_id: string
        }
        Returns: Json
      }
      claim_telegram_delivery_v2: {
        Args: {
          p_chat_id: string
          p_claim_ttl_seconds?: number
          p_delivery_key: string
          p_epoch_generation: number
          p_lineage_time: string
          p_source?: string
          p_subject_id: string
        }
        Returns: Json
      }
      claim_video_render_after: {
        Args: { p_queued_after: string; worker_id?: string }
        Returns: Database["public"]["Tables"]["video_renders"]["Row"][]
      }
      claim_video_render_by_id: {
        Args: { render_id: string; worker_id?: string }
        Returns: {
          ass_subtitles: string | null
          attempts: number
          block_reason: string | null
          blocked_at: string | null
          claim_generation: number
          claim_token: string | null
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          expires_at: string | null
          failed_at: string | null
          failure_policy: string
          height: number | null
          id: string
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          metrics: Json
          original_srt: string | null
          output_file_size: number | null
          output_mime_type: string | null
          output_storage_path: string | null
          persian_srt: string | null
          posted_at: string | null
          preflight: Json
          queued_at: string
          render_revision: number
          render_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_language: string | null
          source_media_id: string
          started_at: string | null
          status: string
          target_language: string | null
          translated_srt: string | null
          tweet_id: string
          updated_at: string
          width: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "video_renders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_video_renders: {
        Args: { batch_size?: number; worker_id?: string }
        Returns: {
          ass_subtitles: string | null
          attempts: number
          block_reason: string | null
          blocked_at: string | null
          claim_generation: number
          claim_token: string | null
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          expires_at: string | null
          failed_at: string | null
          failure_policy: string
          height: number | null
          id: string
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          metrics: Json
          original_srt: string | null
          output_file_size: number | null
          output_mime_type: string | null
          output_storage_path: string | null
          persian_srt: string | null
          posted_at: string | null
          preflight: Json
          queued_at: string
          render_revision: number
          render_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_language: string | null
          source_media_id: string
          started_at: string | null
          status: string
          target_language: string | null
          translated_srt: string | null
          tweet_id: string
          updated_at: string
          width: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "video_renders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_x_post_delivery: {
        Args: {
          p_claim_ttl_seconds?: number
          p_force_retry?: boolean
          p_post_id: string
          p_source?: string
        }
        Returns: Json
      }
      claim_x_post_delivery_v2: {
        Args: {
          p_claim_ttl_seconds?: number
          p_epoch_generation: number
          p_force_retry?: boolean
          p_lineage_time: string
          p_post_id: string
          p_source?: string
        }
        Returns: Json
      }
      cleanup_old_data: {
        Args: { batch_limit?: number; retention_days?: number }
        Returns: Json
      }
      complete_job: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_completed_at?: string
          p_job_id: string
          p_last_error?: string
        }
        Returns: boolean
      }
      complete_telegram_delivery: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_delivery_id: string
          p_message_ids?: string[]
        }
        Returns: boolean
      }
      complete_video_render: {
        Args: {
          p_ass_subtitles?: string
          p_claim_generation: number
          p_claim_token: string
          p_duration_ms?: number
          p_height?: number
          p_metrics?: Json
          p_original_srt?: string
          p_output_file_size?: number
          p_output_storage_path: string
          p_persian_srt?: string
          p_preflight?: Json
          p_render_id: string
          p_source_language?: string
          p_target_language?: string
          p_translated_srt?: string
          p_width?: number
          p_worker_id: string
        }
        Returns: Json
      }
      complete_webhook_receipt: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_item_outcomes?: Json
          p_receipt_key: string
        }
        Returns: boolean
      }
      complete_x_post_delivery: {
        Args: {
          p_api_response?: Json
          p_claim_generation: number
          p_claim_token: string
          p_delivery_id: string
          p_last_error?: string
          p_latency_ms?: number
          p_media_bytes?: number
          p_media_count?: number
          p_media_kind?: string
          p_posted_at?: string
          p_x_tweet_id: string
        }
        Returns: boolean
      }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_role: { Args: never; Returns: Database["public"]["Enums"]["app_role"] | null }
      delivery_cutover_allows_job: {
        Args: { p_created_at: string; p_tweet_id: string }
        Returns: boolean
      }
      delivery_cutover_allows_post: {
        Args: { p_tweet_id: string }
        Returns: boolean
      }
      enqueue_video_render: {
        Args: {
          p_failure_policy?: string
          p_render_version?: string
          p_source_media_id: string
          p_tweet_id: string
        }
        Returns: string
      }
      fail_digest_run: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_reason?: string
          p_run_key: string
        }
        Returns: boolean
      }
      fail_video_render: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_error: string
          p_metrics?: Json
          p_render_id: string
          p_worker_id: string
        }
        Returns: Json
      }
      fail_webhook_receipt: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_reason?: string
          p_receipt_key: string
        }
        Returns: boolean
      }
      fail_x_post_delivery: {
        Args: {
          p_api_response?: Json
          p_claim_generation: number
          p_claim_token: string
          p_delivery_id: string
          p_error?: string
          p_media_bytes?: number
          p_media_count?: number
          p_media_kind?: string
          p_next_retry_at?: string
          p_skip_reason?: string
          p_status?: string
        }
        Returns: boolean
      }
      feedback_score_residual: {
        Args: { feedback_meta: Json; polarity: number }
        Returns: number
      }
      find_similar_story: {
        Args: {
          exclude_tweet_id: string
          query_embedding: string
          query_simhash: number
          similarity_threshold?: number
          window_hours?: number
        }
        Returns: {
          simhash_distance: number
          similarity: number
          story_cluster_id: string
          tweet_id: string
        }[]
      }
      find_similar_story_v2: {
        Args: {
          exclude_tweet_id: string
          query_embedding: string
          query_simhash: number
          similarity_threshold?: number
          window_hours?: number
        }
        Returns: {
          simhash_distance: number
          similarity: number
          story_cluster_id: string
          tweet_id: string
        }[]
      }
      find_story_candidates_v3: {
        Args: {
          candidate_min_similarity?: number
          exclude_tweet_id: string
          match_limit?: number
          query_embedding: string
          window_hours?: number
        }
        Returns: {
          author_handle: string
          candidate_dedupe_status: string
          candidate_delivery_decision: string
          candidate_dup_of_tweet_id: string
          candidate_final_score: number
          candidate_importance_score: number
          created_at: string
          normalized_text: string
          similarity: number
          story_cluster_id: string
          text_original: string
          text_translated: string
          tweet_id: string
          url: string
        }[]
      }
      get_dashboard_summary: { Args: never; Returns: Json }
      get_delivery_cutover: { Args: never; Returns: string }
      get_expired_video_render_paths: {
        Args: { limit_count?: number }
        Returns: {
          id: string
          output_storage_path: string
        }[]
      }
      get_ingest_heartbeat: { Args: never; Returns: Json }
      get_old_media: {
        Args: { days_old?: number }
        Returns: {
          id: string
          storage_path: string
          tweet_id: string
        }[]
      }
      get_post_pipeline_status: {
        Args: { tweet_ids: string[] }
        Returns: {
          attempts: number
          delivery_error: string
          delivery_status: string
          hydrated_at: string
          hydration_source: string
          ingest_at: string
          is_truncated: boolean
          lang_original: string
          media_downloaded: number
          media_total: number
          posted_at: string
          translate_error: string
          translate_status: string
          translated_at: string
          tweet_id: string
          x_error: string
          x_posted_at: string
          x_skip_reason: string
          x_status: string
          x_tweet_id: string
        }[]
      }
      get_system_health: { Args: never; Returns: Json }
      get_system_resource_usage: { Args: never; Returns: Json }
      get_top_performing_posts: {
        Args: { p_limit?: number }
        Returns: {
          delivery_time_ms: number
          post_id: string
          sent_at: string
          title: string
        }[]
      }
      get_x_post_candidates: {
        Args: { candidate_limit?: number; target_tweet_id?: string }
        Returns: {
          account_handle: string
          author_handle: string
          candidate_age_ms: number
          candidate_reason: string
          commentary_hook: string
          commentary_question: string
          composed_post_text: string
          created_at: string
          decision_reason: string
          dedupe_reason: string
          dedupe_status: string
          delivery_decision: string
          dispatch_source: string
          dup_of_tweet_id: string
          dup_similarity: number
          enrich_status: string
          final_score: number
          final_x_text: string
          has_media: boolean
          humanized_commentary: string
          hydrated_at: string
          importance_score: number
          is_truncated: boolean
          narrative_callback: string
          post_format_hint: string
          text_original: string
          text_translated: string
          thread_continuation: string
          tweet_id: string
          url: string
        }[]
      }
      get_x_posting_summary: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      initialize_delivery_cutover: {
        Args: { p_initialized_by?: string }
        Returns: string
      }
      invoke_x_poster_if_enabled: { Args: never; Returns: undefined }
      knn_feedback_prior: {
        Args: {
          exclude_tweet_id: string
          half_life_days?: number
          k?: number
          query_embedding: string
        }
        Returns: number
      }
      knn_feedback_prior_details: {
        Args: {
          exclude_tweet_id: string
          half_life_days?: number
          k?: number
          min_similarity?: number
          query_embedding: string
        }
        Returns: {
          max_similarity: number
          mean_similarity: number
          negative_count: number
          neighbor_count: number
          positive_count: number
          prior: number
          recent_negative_count: number
        }[]
      }
      mark_digest_provider_started: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_run_key: string
        }
        Returns: boolean
      }
      mark_job_provider_started: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_job_id: string
        }
        Returns: boolean
      }
      mark_telegram_delivery_ambiguous: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_delivery_id: string
          p_error?: string
          p_message_ids?: string[]
        }
        Returns: boolean
      }
      mark_video_render_posted: {
        Args: { p_retention_hours?: number; p_tweet_id: string }
        Returns: number
      }
      mark_video_renders_expired: {
        Args: { render_ids: string[] }
        Returns: number
      }
      mark_x_delivery_provider_started: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_delivery_id: string
        }
        Returns: boolean
      }
      media_objects_claim_old: {
        Args: { p_bucket_id?: string; p_days_old?: number; p_max?: number }
        Returns: {
          bucket: string
          deletion_token: string
          mime_type: string
          object_id: string
          storage_path: string
        }[]
      }
      media_objects_finalize_delete: {
        Args: { p_deletion_token: string; p_object_id: string }
        Returns: boolean
      }
      media_objects_preview_old: {
        Args: { p_bucket_id?: string; p_days_old?: number; p_max?: number }
        Returns: {
          bucket: string
          mime_type: string
          object_id: string
          storage_path: string
        }[]
      }
      persist_digest_output: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_formatted_tweets: Json
          p_output_key: string
          p_run_key: string
          p_status?: string
          p_summary_text: string
        }
        Returns: boolean
      }
      persist_skipped_digest: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_output_key: string
          p_reason: string
          p_run_key: string
        }
        Returns: boolean
      }
      rebuild_learned_biases: {
        Args: { half_life_days?: number; per_key_cap?: number }
        Returns: Json
      }
      reconcile_expired_job_claims: {
        Args: { p_max_claims?: number }
        Returns: Json
      }
      reconcile_expired_webhook_receipts: {
        Args: { p_max_receipts?: number }
        Returns: Json
      }
      reconcile_stuck_jobs: { Args: never; Returns: Json }
      renew_video_render_lease: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_lease_seconds?: number
          p_render_id: string
          p_worker_id: string
        }
        Returns: boolean
      }
      reserve_digest_run: {
        Args: {
          p_delivery_key?: string
          p_input_fingerprint: string
          p_lease_seconds?: number
          p_period_end: string
          p_period_start: string
          p_post_ids?: string[]
          p_run_key: string
        }
        Returns: Json
      }
      reserve_webhook_receipt: {
        Args: {
          p_auth_mode?: string
          p_feed_id?: string
          p_receipt_key: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      retry_step: { Args: { step: string; tweet_id: string }; Returns: boolean }
      runtime_v2_allows_lineage: {
        Args: { p_epoch_generation: number; p_lineage_time: string }
        Returns: boolean
      }
      settle_delivery_cutover_blocked: {
        Args: { p_job_id: string; p_reason?: string }
        Returns: boolean
      }
      update_runtime_controls: {
        Args: {
          p_dedupe_enabled: boolean
          p_translation_enabled: boolean
        }
        Returns: {
          dedupe_enabled: boolean
          environment: string
          posting_mode: string
          singleton_id: boolean
          singleton_key: boolean
          translation_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
      }
      update_runtime_controls_v2: {
        Args: {
          p_dedupe_enabled: boolean
          p_translation_enabled: boolean
        }
        Returns: Database["public"]["Tables"]["runtime_controls"]["Row"]
      }
      assert_delivery_cutover_post: {
        Args: { p_tweet_id: string }
        Returns: undefined
      }
      save_video_render_feedback_if_current: {
        Args: {
          p_created_by: string
          p_expected_render_revision: number
          p_expected_render_version: string
          p_label: string
          p_metadata: Json
          p_note: string
          p_render_id: string
        }
        Returns: {
          created_at: string
          id: string
          label: string
          note: string
          render_revision: number
          render_version: string
          tweet_id: string
        }[]
      }
      start_telegram_delivery: {
        Args: {
          p_claim_generation: number
          p_claim_token: string
          p_delivery_id: string
        }
        Returns: boolean
      }
      verify_webhook_internal_token: {
        Args: { p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "read_only"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "read_only"],
    },
  },
} as const
