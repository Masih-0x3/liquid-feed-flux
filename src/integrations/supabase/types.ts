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
    PostgrestVersion: "13.0.4"
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
          lang_dst: string | null
          lang_src: string | null
          last_seen_item_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          handle: string
          id?: string
          lang_dst?: string | null
          lang_src?: string | null
          last_seen_item_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          handle?: string
          id?: string
          lang_dst?: string | null
          lang_src?: string | null
          last_seen_item_id?: string | null
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          attempts: number | null
          created_at: string
          id: string
          last_error: string | null
          status: string | null
          subject_id: string
          subject_type: string | null
          telegram_chat_id: string | null
          telegram_message_ids: string[] | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string
          id?: string
          last_error?: string | null
          status?: string | null
          subject_id: string
          subject_type?: string | null
          telegram_chat_id?: string | null
          telegram_message_ids?: string[] | null
        }
        Update: {
          attempts?: number | null
          created_at?: string
          id?: string
          last_error?: string | null
          status?: string | null
          subject_id?: string
          subject_type?: string | null
          telegram_chat_id?: string | null
          telegram_message_ids?: string[] | null
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
          created_at: string
          id: string
          last_error: string | null
          next_run_at: string | null
          payload: Json | null
          status: string | null
          type: string
        }
        Insert: {
          attempts?: number | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_run_at?: string | null
          payload?: Json | null
          status?: string | null
          type: string
        }
        Update: {
          attempts?: number | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_run_at?: string | null
          payload?: Json | null
          status?: string | null
          type?: string
        }
        Relationships: []
      }
      media: {
        Row: {
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          kind: string | null
          ordering: number | null
          src_url: string | null
          tweet_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          kind?: string | null
          ordering?: number | null
          src_url?: string | null
          tweet_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          kind?: string | null
          ordering?: number | null
          src_url?: string | null
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
      posts: {
        Row: {
          account_id: string
          created_at: string
          has_media: boolean | null
          lang_original: string | null
          text_original: string | null
          text_translated: string | null
          tweet_id: string
          tweeted_at: string | null
          url: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          has_media?: boolean | null
          lang_original?: string | null
          text_original?: string | null
          text_translated?: string | null
          tweet_id: string
          tweeted_at?: string | null
          url?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          has_media?: boolean | null
          lang_original?: string | null
          text_original?: string | null
          text_translated?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
