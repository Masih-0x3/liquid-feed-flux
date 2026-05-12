export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
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
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          posted_at: string | null
          status: string | null
          subject_id: string
          subject_type: string | null
          target_chat: string | null
          telegram_chat_id: string | null
          telegram_message_ids: string[] | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          posted_at?: string | null
          status?: string | null
          subject_id: string
          subject_type?: string | null
          target_chat?: string | null
          telegram_chat_id?: string | null
          telegram_message_ids?: string[] | null
        }
        Update: {
          attempts?: number | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          posted_at?: string | null
          status?: string | null
          subject_id?: string
          subject_type?: string | null
          target_chat?: string | null
          telegram_chat_id?: string | null
          telegram_message_ids?: string[] | null
        }
        Relationships: []
      }
      digests: {
        Row: {
          created_at: string
          error: string | null
          id: string
          period_end: string
          period_start: string
          post_ids: string[] | null
          status: string
          summary_text: string | null
          twitter_tweet_ids: string[] | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          period_end: string
          period_start: string
          post_ids?: string[] | null
          status?: string
          summary_text?: string | null
          twitter_tweet_ids?: string[] | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          period_end?: string
          period_start?: string
          post_ids?: string[] | null
          status?: string
          summary_text?: string | null
          twitter_tweet_ids?: string[] | null
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
          result_meta: Json | null
          started_at: string | null
          status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
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
          result_meta?: Json | null
          started_at?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
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
          result_meta?: Json | null
          started_at?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
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
          ordering?: number | null
          src_url?: string | null
          src_url_hash?: string | null
          storage_path?: string | null
          tweet_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_tweet_id_fkey"
            columns: ["tweet_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["tweet_id"]
          },
        ]
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
      posts: {
        Row: {
          account_id: string
          author_handle: string | null
          created_at: string
          decision_reason: string | null
          delivery_decision: string | null
          dup_of_tweet_id: string | null
          dup_similarity: number | null
          final_score: number | null
          has_media: boolean | null
          hydrated_at: string | null
          hydration_source: string | null
          importance_reasoning: string | null
          importance_score: number | null
          importance_tags: string[] | null
          is_truncated: boolean
          lang_original: string | null
          score_axes: Json | null
          story_cluster_id: string | null
          text_original: string | null
          text_translated: string | null
          translated_at: string | null
          translation_duration_ms: number | null
          translation_job_id: string | null
          translation_model: string | null
          translation_tokens: number | null
          tweet_id: string
          tweeted_at: string | null
          url: string | null
        }
        Insert: {
          account_id: string
          author_handle?: string | null
          created_at?: string
          decision_reason?: string | null
          delivery_decision?: string | null
          dup_of_tweet_id?: string | null
          dup_similarity?: number | null
          final_score?: number | null
          has_media?: boolean | null
          hydrated_at?: string | null
          hydration_source?: string | null
          importance_reasoning?: string | null
          importance_score?: number | null
          importance_tags?: string[] | null
          is_truncated?: boolean
          lang_original?: string | null
          score_axes?: Json | null
          story_cluster_id?: string | null
          text_original?: string | null
          text_translated?: string | null
          translated_at?: string | null
          translation_duration_ms?: number | null
          translation_job_id?: string | null
          translation_model?: string | null
          translation_tokens?: number | null
          tweet_id: string
          tweeted_at?: string | null
          url?: string | null
        }
        Update: {
          account_id?: string
          author_handle?: string | null
          created_at?: string
          decision_reason?: string | null
          delivery_decision?: string | null
          dup_of_tweet_id?: string | null
          dup_similarity?: number | null
          final_score?: number | null
          has_media?: boolean | null
          hydrated_at?: string | null
          hydration_source?: string | null
          importance_reasoning?: string | null
          importance_score?: number | null
          importance_tags?: string[] | null
          is_truncated?: boolean
          lang_original?: string | null
          score_axes?: Json | null
          story_cluster_id?: string | null
          text_original?: string | null
          text_translated?: string | null
          translated_at?: string | null
          translation_duration_ms?: number | null
          translation_job_id?: string | null
          translation_model?: string | null
          translation_tokens?: number | null
          tweet_id?: string
          tweeted_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
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
      x_deliveries: {
        Row: {
          api_response: Json | null
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          latency_ms: number | null
          media_bytes: number
          media_count: number
          media_kind: string | null
          post_id: string
          posted_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
          x_tweet_id: string | null
        }
        Insert: {
          api_response?: Json | null
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          latency_ms?: number | null
          media_bytes?: number
          media_count?: number
          media_kind?: string | null
          post_id: string
          posted_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
          x_tweet_id?: string | null
        }
        Update: {
          api_response?: Json | null
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          latency_ms?: number | null
          media_bytes?: number
          media_count?: number
          media_kind?: string | null
          post_id?: string
          posted_at?: string | null
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
      calculate_growth_rate: {
        Args: { p_chat_id: string; p_days?: number }
        Returns: {
          growth_rate: number
          net_growth: number
          total_joined: number
          total_left: number
        }[]
      }
      claim_jobs: {
        Args: { batch_size?: number; job_types?: string[]; worker_id?: string }
        Returns: {
          attempts: number | null
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
      cleanup_old_data: {
        Args: { batch_limit?: number; retention_days?: number }
        Returns: Json
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
      get_dashboard_summary: { Args: never; Returns: Json }
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
      get_top_performing_posts: {
        Args: { p_limit?: number }
        Returns: {
          delivery_time_ms: number
          post_id: string
          sent_at: string
          title: string
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
      reconcile_stuck_jobs: { Args: never; Returns: Json }
      retry_step: { Args: { step: string; tweet_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "viewer"
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
      app_role: ["admin", "viewer"],
    },
  },
} as const
